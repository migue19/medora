import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  Client, Harness, addStaff, createClinicWithOwner, localIso, loginStaff, nextMonday, randomUUID, registerPatient, resetDb, startHarness,
} from './harness';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const SLUG = 'clinica-integra';
let owner: Client;
let doctorId: string;
let serviceId: string;
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: 540, endMinute: 780 }));

beforeEach(async () => {
  await resetDb(h.prisma);
  await h.prisma.$executeRawUnsafe('TRUNCATE "ApiKey", "WebhookDelivery", "WebhookEndpoint", "CalendarConnection", "PushSubscription" CASCADE');
  h.webhooks.received = []; h.webhooks.respond = 200;
  h.calendar.events.clear(); h.calendar.watches = []; h.calendar.revoked = false;
  const created = await createClinicWithOwner(h.prisma, SLUG);
  owner = await loginStaff(h.base, created.email, created.password, SLUG);
  serviceId = (await owner.post('/api/clinic/services', { name: 'Consulta', durationMinutes: 30, priceCents: 70000 })).body.id;
  doctorId = (await owner.post('/api/clinic/doctors', { displayName: 'Dra. Ana', specialty: 'Medicina general', serviceIds: [serviceId] })).body.id;
  await owner.put(`/api/clinic/doctors/${doctorId}/schedule`, { rules: ALL_WEEK });
  await h.deliver();
});

/** Cliente de un tercero con su llave. */
const api = (key: string) => {
  const c = new Client(h.base);
  c.token = key;
  return c;
};
const runAll = async () => { for (let i = 0; i < 4; i++) await h.jobs.runOnce(); };

test('API pública: llaves por clínica con permisos; un tercero consulta, agenda y cancela citas', async () => {
  const ro = (await owner.post('/api/clinic/integrations/keys', { name: 'CRM', scopes: [] })).body;
  assert.match(ro.secret, /^mdr_/);
  assert.deepEqual(ro.scopes, ['read']);
  const listed = (await owner.get('/api/clinic/integrations')).body.keys;
  assert.equal(JSON.stringify(listed).includes(ro.secret), false, 'la llave completa sólo se muestra al crearla');
  assert.equal((await new Client(h.base).get('/api/v1/doctors')).status, 401);
  assert.equal((await api('mdr_' + 'x'.repeat(32)).get('/api/v1/doctors')).status, 401);
  const doctors = await api(ro.secret).get('/api/v1/doctors');
  assert.deepEqual(doctors.body.data.map((d: { name: string }) => d.name), ['Dra. Ana']);
  const monday = nextMonday();
  const slots = (await api(ro.secret).get(`/api/v1/availability?doctorId=${doctorId}&serviceId=${serviceId}&from=${monday}&days=1`)).body;
  assert.equal(slots.data[0].slots[0].startsAt, localIso(monday, '09:00'));
  const body = { requestId: randomUUID(), doctorId, serviceId, startsAt: localIso(monday, '09:00'), patient: { name: 'Luis Gómez', phone: '55 2222 3333', email: 'luis@x.test' } };
  assert.equal((await api(ro.secret).post('/api/v1/appointments', body)).status, 403, 'sólo lectura no agenda');

  const rw = (await owner.post('/api/clinic/integrations/keys', { name: 'Sitio web', scopes: ['write'] })).body;
  const created = await api(rw.secret).post('/api/v1/appointments', body);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const a = created.body.data;
  assert.deepEqual([a.status, a.source, a.channel, a.patient.name, a.priceCents, a.currency], ['booked', 'api', 'api', 'Luis Gómez', 70000, 'MXN']);
  assert.equal((await api(rw.secret).post('/api/v1/appointments', body)).body.data.id, a.id, 'mismo requestId: misma cita');
  // Mismo teléfono (con otro formato): es el mismo paciente.
  const second = await api(rw.secret).post('/api/v1/appointments', { ...body, requestId: randomUUID(), startsAt: localIso(monday, '10:00'), patient: { name: 'Luis G.', phone: '+52 55-2222-3333' } });
  assert.equal(second.body.data.patient.id, a.patient.id);
  // Empalme con el horario del médico: 409.
  assert.equal((await api(rw.secret).post('/api/v1/appointments', { ...body, requestId: randomUUID() })).status, 409);

  const list = (await api(ro.secret).get(`/api/v1/appointments?from=${monday}&to=${monday}`)).body;
  assert.deepEqual([list.total, list.hasMore], [2, false]);
  const since = new Date().toISOString();
  const cancelled = await api(rw.secret).post(`/api/v1/appointments/${a.id}/cancel`, { reason: 'El paciente avisó por teléfono' });
  assert.equal(cancelled.body.data.status, 'cancelled');
  const changed = (await api(ro.secret).get(`/api/v1/appointments?from=${monday}&to=${monday}&updatedSince=${since}`)).body;
  assert.deepEqual(changed.data.map((x: { id: string }) => x.id), [a.id], 'sincronización incremental');
  // La cita queda en la agenda del panel como «API».
  const agenda = (await owner.get(`/api/clinic/appointments?from=${monday}`)).body.appointments;
  assert.equal(agenda.find((x: { id: string }) => x.id === second.body.data.id).channel, 'api');

  // Otra clínica no ve estas citas; una llave revocada deja de funcionar.
  const other = await createClinicWithOwner(h.prisma, 'otra-clinica');
  const otherOwner = await loginStaff(h.base, other.email, other.password, 'otra-clinica');
  const otherRes = await otherOwner.post('/api/clinic/integrations/keys', { name: 'Otra', scopes: [] });
  assert.equal(otherRes.status, 201, JSON.stringify(otherRes.body));
  const otherKey = otherRes.body.secret;
  assert.equal((await api(otherKey).get(`/api/v1/appointments/${a.id}`)).status, 404);
  await owner.del(`/api/clinic/integrations/keys/${ro.id}`);
  assert.equal((await api(ro.secret).get('/api/v1/doctors')).status, 401);
});

test('webhooks de citas: firmados, filtrados por evento y con reintentos', async () => {
  assert.equal((await owner.post('/api/clinic/integrations/webhooks', { url: 'http://hooks.example.com/x' })).status, 400);
  assert.equal((await owner.post('/api/clinic/integrations/webhooks', { url: 'https://127.0.0.1/x' })).status, 400);
  assert.equal((await owner.post('/api/clinic/integrations/webhooks', { url: 'https://hooks.example.com/x', events: ['appointment.borrada'] })).status, 400);
  const all = (await owner.post('/api/clinic/integrations/webhooks', { url: 'https://hooks.example.com/medora' })).body;
  const onlyCancel = (await owner.post('/api/clinic/integrations/webhooks', { url: 'https://crm.example.com/cancelaciones', events: ['appointment.cancelled'] })).body;
  assert.match(all.secret, /^whsec_/);
  assert.deepEqual((await owner.post(`/api/clinic/integrations/webhooks/${all.id}/ping`)).body, { ok: true, status: 200 });
  h.webhooks.received = [];

  const patient = await registerPatient(h.base, 'Ana');
  const booked = (await patient.post(`/api/public/clinics/${SLUG}/appointments`, { requestId: randomUUID(), doctorId, serviceId, startsAt: localIso(nextMonday(), '11:00') })).body.appointment;
  await runAll();
  assert.deepEqual(h.webhooks.received.map((r) => [r.url, r.headers['medora-event']]), [['https://hooks.example.com/medora', 'appointment.created']]);
  const req = h.webhooks.received[0];
  const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(req.headers['medora-signature'])!;
  assert.equal(createHmac('sha256', all.secret).update(`${t}.${req.body}`).digest('hex'), v1, 'firma verificable con el secreto');
  const payload = JSON.parse(req.body);
  assert.deepEqual([payload.type, payload.data.appointment.id, payload.data.appointment.status, payload.data.appointment.source], ['appointment.created', booked.id, 'booked', 'online']);

  // Cancelación: le llega a los dos; el CRM caído reintenta.
  h.webhooks.received = [];
  h.webhooks.respond = 503;
  await owner.post(`/api/clinic/appointments/${booked.id}/cancel`, { reason: 'Médico en urgencia' });
  await runAll();
  assert.deepEqual(h.webhooks.received.map((r) => r.headers['medora-event']).sort(), ['appointment.cancelled', 'appointment.cancelled']);
  const failed = await h.prisma.webhookDelivery.findFirstOrThrow({ where: { endpointId: onlyCancel.id } });
  assert.deepEqual([failed.status, failed.attempts, failed.responseCode], ['FAILED', 1, 503]);
  const job = await h.prisma.job.findFirstOrThrow({ where: { type: 'webhook.deliver', dedupeKey: `webhook:${failed.id}` } });
  assert.equal(job.failedAt, null, 'queda programado para reintentar');
  h.webhooks.respond = 200;
  await h.jobs.runOnce(new Date(Date.now() + 60 * 60_000));
  const ok = await h.prisma.webhookDelivery.findFirstOrThrow({ where: { id: failed.id } });
  assert.deepEqual([ok.status, ok.attempts], ['DELIVERED', 2]);
  const overview = (await owner.get('/api/clinic/integrations')).body.webhooks;
  assert.equal(overview.find((w: { id: string }) => w.id === onlyCancel.id).deliveries[0].status, 'DELIVERED');
});

test('Google Calendar: un evento personal bloquea la agenda al instante y las citas se escriben en el calendario', async () => {
  const doc = await addStaff(h, owner, { name: 'Ana', email: 'ana@integra.mx', role: 'DOCTOR', password: 'medico-seguro-123' });
  await owner.patch(`/api/clinic/doctors/${doctorId}`, { membershipId: doc.membershipId });
  const ana = await loginStaff(h.base, 'ana@integra.mx', 'medico-seguro-123', SLUG);
  const monday = nextMonday();
  // Una cita ya agendada antes de conectar se copia al calendario.
  const patient = await registerPatient(h.base, 'Ana');
  const before = (await patient.post(`/api/public/clinics/${SLUG}/appointments`, { requestId: randomUUID(), doctorId, serviceId, startsAt: localIso(monday, '09:00') })).body.appointment;
  await runAll();

  assert.equal((await owner.post('/api/clinic/calendar/google/start')).status, 403, 'sólo el médico conecta su calendario');
  const start = await ana.post('/api/clinic/calendar/google/start');
  const state = new URL(start.body.url).searchParams.get('state')!;
  const bad = await fetch(`${h.base}/api/integrations/google/callback?code=codigo-valido&state=${state.slice(0, -2)}xx`, { redirect: 'manual' });
  assert.match(bad.headers.get('location')!, /calendario=error/);
  const cb = await fetch(`${h.base}/api/integrations/google/callback?code=codigo-valido&state=${state}`, { redirect: 'manual' });
  assert.equal(cb.status, 302);
  assert.match(cb.headers.get('location')!, /\/panel\?tab=account&calendario=conectado$/);
  const conn = await h.prisma.calendarConnection.findFirstOrThrow();
  assert.equal(conn.accountEmail, 'dra.ana@gmail.test');
  assert.equal(conn.accessToken.includes('acceso-1') || conn.refreshToken.includes('renovacion-1'), false, 'tokens cifrados');
  assert.equal(h.calendar.watches[0].notifyUrl, 'http://localhost:6011/api/integrations/google/notify');
  await runAll();
  const pushed = [...h.calendar.events.values()].find((e) => e.medora === before.id);
  assert.match(pushed!.title!, /^Cita: Ana · Consulta/);

  // Evento personal de 10:00 a 11:00: Google avisa y en segundos ya no se ofrecen esos horarios.
  h.calendar.add('dentista', new Date(localIso(monday, '10:00')), new Date(localIso(monday, '11:00')));
  h.calendar.add('libre', new Date(localIso(monday, '11:00')), new Date(localIso(monday, '12:00')), { free: true });
  h.calendar.add('rechazada', new Date(localIso(monday, '12:00')), new Date(localIso(monday, '12:30')), { declined: true });
  const watch = h.calendar.watches[0];
  const wrong = await fetch(`${h.base}/api/integrations/google/notify`, { method: 'POST', headers: { 'x-goog-channel-id': watch.channelId, 'x-goog-channel-token': 'otro' } });
  assert.equal(wrong.status, 200);
  const notifiedAt = Date.now();
  await fetch(`${h.base}/api/integrations/google/notify`, { method: 'POST', headers: { 'x-goog-channel-id': watch.channelId, 'x-goog-channel-token': watch.token, 'x-goog-resource-state': 'exists' } });
  const job = await h.prisma.job.findFirstOrThrow({ where: { type: 'calendar.sync', completedAt: null }, orderBy: { runAt: 'asc' } });
  assert.ok(job.runAt.getTime() - notifiedAt < 60_000, 'la sincronización corre de inmediato');
  await h.jobs.runOnce();
  const busy = await h.prisma.externalBusy.findMany();
  assert.deepEqual(busy.map((b) => b.externalId), ['dentista'], 'ni libres, ni rechazados, ni las citas de Medora');
  const times = (await new Client(h.base).get(`/api/public/clinics/${SLUG}/doctors/${doctorId}/availability?serviceId=${serviceId}&from=${monday}&days=1`))
    .body.days[0].slots.map((s: { time: string }) => s.time);
  assert.ok(!times.includes('10:00') && !times.includes('10:30') && times.includes('11:00') && times.includes('09:30'));
  const blocked = await patient.post(`/api/public/clinics/${SLUG}/appointments`, { requestId: randomUUID(), doctorId, serviceId, startsAt: localIso(monday, '10:00') });
  assert.equal(blocked.status, 409);
  // La agenda del panel muestra el bloque (sólo el horario).
  assert.equal((await owner.get(`/api/clinic/calendar/busy?from=${monday}`)).body.length, 1);

  // Cita nueva → aparece en el calendario; cancelada → se quita.
  const later = (await patient.post(`/api/public/clinics/${SLUG}/appointments`, { requestId: randomUUID(), doctorId, serviceId, startsAt: localIso(monday, '11:00') })).body.appointment;
  await runAll();
  assert.ok([...h.calendar.events.values()].some((e) => e.medora === later.id));
  await owner.post(`/api/clinic/appointments/${later.id}/cancel`, { reason: 'Reprogramar' });
  await runAll();
  assert.ok(![...h.calendar.events.values()].some((e) => e.medora === later.id));

  // Acceso revocado en Google: la conexión queda en error y lo ve el médico.
  h.calendar.revoked = true;
  await h.prisma.calendarConnection.update({ where: { id: conn.id }, data: { tokenExpiresAt: new Date() } });
  await h.app.get((await import('../../src/integrations/calendar.service')).CalendarService).sync(conn.id).catch(() => undefined);
  const status = (await ana.get('/api/clinic/calendar')).body.providers.find((p: { provider: string }) => p.provider === 'GOOGLE');
  assert.equal(status.connection.status, 'ERROR');
  assert.equal((await ana.del('/api/clinic/calendar/google')).status, 204);
  assert.equal(await h.prisma.externalBusy.count(), 0, 'al desconectar se quitan los bloqueos');
});

test('notificaciones push: cita nueva en línea y cancelación al médico y a recepción; suscripciones vencidas se borran', async () => {
  h.push.sent = []; h.push.gone.clear();
  const doc = await addStaff(h, owner, { name: 'Ana', email: 'ana@integra.mx', role: 'DOCTOR', password: 'medico-seguro-123' });
  await owner.patch(`/api/clinic/doctors/${doctorId}`, { membershipId: doc.membershipId });
  await addStaff(h, owner, { name: 'Rocío', email: 'rocio@integra.mx', role: 'RECEPTION', password: 'recepcion-segura-1' });
  const ana = await loginStaff(h.base, 'ana@integra.mx', 'medico-seguro-123', SLUG);
  const rocio = await loginStaff(h.base, 'rocio@integra.mx', 'recepcion-segura-1', SLUG);
  assert.deepEqual((await ana.get('/api/clinic/push/key')).body, { publicKey: 'BPrueba' });
  assert.equal((await ana.post('/api/clinic/push/subscribe', { endpoint: 'http://inseguro', keys: { p256dh: 'x', auth: 'y' } })).status, 400);
  await ana.post('/api/clinic/push/subscribe', { endpoint: 'https://push.test/ana', keys: { p256dh: 'p', auth: 'a' } });
  await rocio.post('/api/clinic/push/subscribe', { endpoint: 'https://push.test/rocio', keys: { p256dh: 'p', auth: 'a' } });
  await owner.post('/api/clinic/push/subscribe', { endpoint: 'https://push.test/dueno', keys: { p256dh: 'p', auth: 'a' } });

  const patient = await registerPatient(h.base, 'Mario');
  const a = (await patient.post(`/api/public/clinics/${SLUG}/appointments`, { requestId: randomUUID(), doctorId, serviceId, startsAt: localIso(nextMonday(), '12:00') })).body.appointment;
  await runAll();
  assert.deepEqual(h.push.sent.map((p) => p.endpoint).sort(), ['https://push.test/ana', 'https://push.test/rocio'], 'el médico y recepción; el propietario no');
  assert.equal(h.push.sent[0].message.title, 'Nueva cita en línea');
  assert.match(h.push.sent[0].message.body, /^Mario · Consulta · .* · Dra\. Ana$/);

  // Recepción ya no tiene esa suscripción en su navegador: se borra al primer intento.
  h.push.sent = [];
  h.push.gone.add('https://push.test/rocio');
  await patient.post(`/api/patient/appointments/${a.id}/cancel`, {});
  await runAll();
  assert.deepEqual(h.push.sent.map((p) => [p.endpoint, p.message.title]), [['https://push.test/ana', 'Cita cancelada']]);
  assert.equal(await h.prisma.pushSubscription.count({ where: { endpoint: 'https://push.test/rocio' } }), 0);
  // Una cita que agenda recepción no genera aviso.
  h.push.sent = [];
  const pid = (await h.prisma.clinicPatient.findFirstOrThrow()).id;
  await owner.post('/api/clinic/appointments', { requestId: randomUUID(), doctorId, serviceId, clinicPatientId: pid, startsAt: localIso(nextMonday(), '12:30') });
  await runAll();
  assert.equal(h.push.sent.length, 0);
});
