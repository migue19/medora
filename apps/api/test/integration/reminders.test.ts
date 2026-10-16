import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Client, Harness, createClinicWithOwner, linkToken, localIso, loginStaff, nextMonday, randomUUID, registerPatient,
  resetDb, startHarness,
} from './harness';
import { randomToken, sha256 } from '../../src/common/crypto';
import { RemindersService } from '../../src/notifications/reminders.service';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const SLUG = 'clinica-a';
const pub = `/api/public/clinics/${SLUG}`;
const anon = () => new Client(h.base);
let owner: Client;
let doctorId: string;
let serviceId: string;
let monday: string;

beforeEach(async () => {
  await resetDb(h.prisma);
  h.mail.sent.length = 0;
  h.mail.failNext = 0;
  h.whatsapp.sent.length = 0;
  h.whatsapp.failNext = 0;
  const created = await createClinicWithOwner(h.prisma, SLUG);
  owner = await loginStaff(h.base, created.email, created.password, SLUG);
  serviceId = (await owner.post('/api/clinic/services', { name: 'Consulta', durationMinutes: 30, priceCents: 60000 })).body.id;
  doctorId = (await owner.post('/api/clinic/doctors', {
    displayName: 'Dr. Juan López', specialty: 'Cardiología', serviceIds: [serviceId],
  })).body.id;
  await owner.put(`/api/clinic/doctors/${doctorId}/schedule`, { rules: [{ weekday: 1, startMinute: 540, endMinute: 660 }] });
  monday = nextMonday();
});

async function bookAs(c: Client, time: string) {
  const r = await c.post(`${pub}/appointments`, { requestId: randomUUID(), doctorId, serviceId, startsAt: localIso(monday, time) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await h.deliver(); // confirmación de la cita
  return r.body.appointment as { id: string; startsAt: string };
}

/** Ejecuta la cola como si fuera `minutes` antes de la cita (más un segundo). */
async function runAt(startsAt: string, minutesBefore: number) {
  const before = h.mail.sent.length;
  const wBefore = h.whatsapp.sent.length;
  await h.jobs.runOnce(new Date(new Date(startsAt).getTime() - minutesBefore * 60_000 + 1000));
  return { mail: h.mail.sent.slice(before), whatsapp: h.whatsapp.sent.slice(wBefore) };
}

async function agendaItem(id: string) {
  const r = await owner.get(`/api/clinic/appointments?from=${monday}&days=1`);
  return r.body.appointments.find((a: { id: string }) => a.id === id);
}

/** Enlace de acción creado directamente (para fijar el horario o el plazo sin esperar). */
async function craftToken(appointmentId: string) {
  const a = await h.prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  const token = randomToken();
  await h.prisma.appointmentActionToken.create({
    data: { appointmentId, tokenHash: sha256(token), startsAt: a.startsAt, expiresAt: a.startsAt },
  });
  return token;
}

test('recordatorios 24 h y 2 h: salen a su hora, una sola vez y quedan en la bitácora', async () => {
  const ana = await registerPatient(h.base, 'Ana');
  const appt = await bookAs(ana, '09:00');
  const jobs = await h.prisma.job.findMany({ where: { type: 'reminder.send' }, orderBy: { runAt: 'asc' } });
  assert.deepEqual(jobs.map((j) => (j.payload as { offsetMinutes: number }).offsetMinutes), [1440, 120]);
  assert.equal(jobs[0].runAt.getTime(), new Date(appt.startsAt).getTime() - 1440 * 60_000);

  assert.equal((await h.deliver()).length, 0, 'todavía no es hora');
  const first = await runAt(appt.startsAt, 1440);
  assert.equal(first.mail.length, 1);
  assert.match(first.mail[0].subject, /^Recordatorio de tu cita: lunes .* 09:00 h$/);
  assert.match(first.mail[0].text, /\/cita#[A-Za-z0-9_-]{20,}/);
  assert.match(first.mail[0].text, /Puedes cancelar desde el enlace hasta el/);
  assert.equal((await runAt(appt.startsAt, 1440)).mail.length, 0);

  // Aunque el trabajo se repita (p. ej. el proceso murió antes de marcarlo), la bitácora impide el duplicado.
  await h.prisma.job.updateMany({ where: { type: 'reminder.send' }, data: { completedAt: null, lockedUntil: null } });
  await Promise.all(Array.from({ length: 5 }, () => h.jobs.runOnce(new Date(new Date(appt.startsAt).getTime() - 1439 * 60_000))));
  assert.equal(h.mail.sent.filter((m) => /Recordatorio/.test(m.subject)).length, 1);

  assert.equal((await runAt(appt.startsAt, 120)).mail.length, 1);
  const item = await agendaItem(appt.id);
  assert.deepEqual(item.reminders.map((r: { channel: string; offsetMinutes: number; status: string }) => [r.channel, r.offsetMinutes, r.status]),
    [['EMAIL', 1440, 'SENT'], ['EMAIL', 120, 'SENT']]);
});

test('confirmar asistencia desde el enlace: un solo uso y visible en la agenda', async () => {
  const ana = await registerPatient(h.base, 'Ana');
  const appt = await bookAs(ana, '09:00');
  const token = linkToken((await runAt(appt.startsAt, 1440)).mail[0]);

  const info = await anon().post('/api/public/appointment-actions/inspect', { token });
  assert.equal(info.status, 200);
  assert.equal(info.body.doctor.displayName, 'Dr. Juan López');
  assert.equal(info.body.canConfirm, true);
  assert.equal(info.body.confirmed, false);
  assert.equal((await anon().req('POST', '/api/public/appointment-actions/confirm', { token }, { origin: 'https://evil.mx' })).status, 403);
  assert.equal((await anon().post('/api/public/appointment-actions/confirm', { token: 'x'.repeat(64) })).status, 400);

  const ok = await anon().post('/api/public/appointment-actions/confirm', { token });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.confirmed, true);
  assert.equal((await anon().post('/api/public/appointment-actions/confirm', { token })).status, 400);
  assert.equal((await anon().post('/api/public/appointment-actions/cancel', { token })).status, 400);
  const after = await anon().post('/api/public/appointment-actions/inspect', { token });
  assert.deepEqual([after.body.used, after.body.confirmed, after.body.canConfirm], [true, true, false]);

  const item = await agendaItem(appt.id);
  assert.ok(item.confirmedAt);
  const detail = await owner.get(`/api/clinic/appointments/${appt.id}`);
  assert.deepEqual(detail.body.events.map((e: { type: string }) => e.type), ['CREATED', 'CONFIRMED']);
  assert.equal(detail.body.events[1].actorName, (await ana.get('/api/patient/me')).body.name);
});

test('cancelar desde el enlace respeta el plazo de la clínica y devuelve el enlace si no se pudo', async () => {
  const ana = await registerPatient(h.base, 'Ana');
  const appt = await bookAs(ana, '09:00');
  // Plazo mayor que el tiempo que falta: no se puede cancelar en línea.
  await h.prisma.clinic.updateMany({ data: { patientCancelMinMinutes: 10080 } });
  await h.prisma.appointment.update({
    where: { id: appt.id },
    data: { startsAt: new Date(Date.now() + 3 * 24 * 3600_000), endsAt: new Date(Date.now() + 3 * 24 * 3600_000 + 30 * 60_000) },
  });
  const token = await craftToken(appt.id);
  const info = await anon().post('/api/public/appointment-actions/inspect', { token });
  assert.deepEqual([info.body.canCancel, info.body.canConfirm], [false, true]);
  const late = await anon().post('/api/public/appointment-actions/cancel', { token });
  assert.equal(late.status, 409);
  assert.match(late.body.message, /comunícate con la clínica/i);
  // El enlace no se gastó: todavía sirve para confirmar.
  assert.equal((await anon().post('/api/public/appointment-actions/confirm', { token })).status, 200);

  await h.prisma.clinic.updateMany({ data: { patientCancelMinMinutes: 120 } });
  const beto = await registerPatient(h.base, 'Beto');
  const other = await bookAs(beto, '10:00');
  const t2 = await craftToken(other.id);
  const cancelled = await anon().post('/api/public/appointment-actions/cancel', { token: t2, reason: 'Me enfermé' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'CANCELLED');
  const [mail] = await h.deliver();
  assert.match(mail.subject, /^Cita cancelada/);
  assert.match(mail.text, /Motivo: Me enfermé/);
  // Los recordatorios de una cita cancelada no salen.
  assert.equal((await runAt(other.startsAt, 1440)).mail.filter((m) => m.to === mail.to).length, 0);
});

test('reprogramar anula los recordatorios y el enlace del horario anterior y reinicia la confirmación', async () => {
  const ana = await registerPatient(h.base, 'Ana');
  const appt = await bookAs(ana, '09:00');
  const oldToken = await craftToken(appt.id);
  assert.equal((await anon().post('/api/public/appointment-actions/confirm', { token: await craftToken(appt.id) })).status, 200);
  assert.ok((await agendaItem(appt.id)).confirmedAt);

  const moved = await owner.post(`/api/clinic/appointments/${appt.id}/reschedule`, {
    startsAt: localIso(monday, '10:00'), expectedStartsAt: appt.startsAt,
  });
  assert.equal(moved.status, 200);
  await h.deliver();
  assert.equal((await agendaItem(appt.id)).confirmedAt, null);

  const stale = await anon().post('/api/public/appointment-actions/inspect', { token: oldToken });
  assert.equal(stale.body.outdated, true);
  assert.equal(stale.body.canConfirm, false);
  assert.equal((await anon().post('/api/public/appointment-actions/confirm', { token: oldToken })).status, 409);

  assert.equal((await runAt(appt.startsAt, 1440)).mail.length, 0, 'el horario anterior ya no recuerda nada');
  const now = await runAt(moved.body.startsAt, 1440);
  assert.equal(now.mail.length, 1);
  assert.match(now.mail[0].subject, /10:00 h$/);
});

test('sólo se programan los recordatorios que todavía caben', async () => {
  const reminders = h.app.get(RemindersService);
  const startsAt = new Date(Date.now() + 10 * 24 * 3600_000);
  const clinic = { remindersEnabled: true, reminderOffsets: [1440, 120], whatsappEnabled: false };
  const id = randomUUID();
  await reminders.schedule(h.prisma as never, { id, startsAt }, clinic, new Date(startsAt.getTime() - 3 * 3600_000));
  const jobs = await h.prisma.job.findMany({ where: { type: 'reminder.send' } });
  assert.deepEqual(jobs.map((j) => (j.payload as { offsetMinutes: number }).offsetMinutes), [120]);
  await reminders.schedule(h.prisma as never, { id: randomUUID(), startsAt }, { ...clinic, remindersEnabled: false });
  assert.equal(await h.prisma.job.count({ where: { type: 'reminder.send' } }), 1);
});

test('WhatsApp: con consentimiento usa la plantilla y el enlace; sin consentimiento queda registrado', async () => {
  assert.equal((await owner.patch('/api/clinic', { whatsappEnabled: true })).status, 200);
  const ana = await registerPatient(h.base, 'Ana');
  const me = (await ana.get('/api/patient/me')).body;
  assert.equal(me.whatsappConsent, false);
  const consent = await ana.patch('/api/patient/me', { name: me.name, phone: '55 1234 5678', whatsappConsent: true });
  assert.equal(consent.body.whatsappConsent, true);
  const beto = await registerPatient(h.base, 'Beto');

  const a1 = await bookAs(ana, '09:00');
  const a2 = await bookAs(beto, '10:00');
  assert.equal(await h.prisma.job.count({ where: { type: 'reminder.send' } }), 8);

  h.whatsapp.failNext = 1;
  const r1 = await runAt(a1.startsAt, 1440);
  assert.equal(r1.mail.length, 1);
  assert.equal(r1.whatsapp.length, 0, 'falló el primer intento');
  const failed = await h.prisma.notificationLog.findFirstOrThrow({ where: { channel: 'WHATSAPP', status: 'FAILED' } });
  assert.match(failed.error!, /Fallo simulado/);
  // Reintento posterior: sale sin repetir el correo.
  const retry = await h.jobs.runOnce(new Date(new Date(a1.startsAt).getTime() - 1380 * 60_000));
  assert.ok(retry >= 1);
  assert.equal(h.whatsapp.sent.length, 1);
  const msg = h.whatsapp.sent[0];
  assert.equal(msg.to, '525512345678');
  assert.deepEqual(msg.bodyParams.slice(0, 2), [me.name, 'Clínica clinica-a']);
  assert.match(msg.bodyParams[2], /09:00 h$/);
  assert.equal(msg.bodyParams[3], 'Dr. Juan López');
  assert.equal((await anon().post('/api/public/appointment-actions/inspect', { token: msg.buttonParam })).status, 200);
  assert.equal(h.mail.sent.filter((m) => /Recordatorio/.test(m.subject) && m.to === me.email).length, 1);

  await runAt(a2.startsAt, 1440);
  const skipped = (await agendaItem(a2.id)).reminders.find((r: { channel: string }) => r.channel === 'WHATSAPP');
  assert.equal(skipped.status, 'SKIPPED');
  assert.equal(skipped.error, 'Sin consentimiento para WhatsApp');
  const sentA1 = (await agendaItem(a1.id)).reminders.filter((r: { status: string }) => r.status === 'SENT');
  assert.deepEqual(sentA1.map((r: { channel: string }) => r.channel).sort(), ['EMAIL', 'WHATSAPP']);
});

test('ajustes de recordatorios y consentimiento de pacientes telefónicos', async () => {
  for (const reminderOffsets of [[10], [1440, 120, 60, 30], [120, 120], [20000]]) {
    assert.equal((await owner.patch('/api/clinic', { reminderOffsets })).status, 400, JSON.stringify(reminderOffsets));
  }
  const saved = await owner.patch('/api/clinic', { reminderOffsets: [60, 2880] });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.reminderOffsets, [2880, 60]);
  assert.equal(saved.body.whatsappAvailable, true);

  const p = await owner.post('/api/clinic/patients', { name: 'Don Pepe', phone: '33 1111 2222', whatsappConsent: true });
  assert.equal(p.body.whatsappConsent, true);
  const off = await owner.patch(`/api/clinic/patients/${p.body.id}`, { whatsappConsent: false });
  assert.equal(off.body.whatsappConsent, false);
  // Un paciente con cuenta en línea decide por sí mismo.
  const ana = await registerPatient(h.base, 'Ana');
  await bookAs(ana, '09:00');
  const linked = (await owner.get('/api/clinic/patients')).body.find((x: { patientAccountId: string | null }) => x.patientAccountId);
  assert.equal((await owner.patch(`/api/clinic/patients/${linked.id}`, { whatsappConsent: true })).status, 403);

  assert.equal((await owner.patch('/api/clinic', { remindersEnabled: false })).status, 200);
  const before = await h.prisma.job.count({ where: { type: 'reminder.send' } });
  await bookAs(await registerPatient(h.base, 'Beto'), '10:00');
  assert.equal(await h.prisma.job.count({ where: { type: 'reminder.send' } }), before);
});
