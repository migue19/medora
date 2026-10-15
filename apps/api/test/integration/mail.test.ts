import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Client, Harness, addStaff, createClinicWithOwner, linkToken, localIso, loginStaff, nextMonday, randomUUID,
  registerPatient, resetDb, startHarness,
} from './harness';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const SLUG = 'clinica-a';
const pub = `/api/public/clinics/${SLUG}`;
let owner: Client;
let ownerEmail: string;
let doctorId: string;
let serviceId: string;
let monday: string;

beforeEach(async () => {
  await resetDb(h.prisma);
  h.mail.sent.length = 0;
  h.mail.failNext = 0;
  const created = await createClinicWithOwner(h.prisma, SLUG);
  ownerEmail = created.email;
  owner = await loginStaff(h.base, created.email, created.password, SLUG);
  serviceId = (await owner.post('/api/clinic/services', { name: 'Consulta', durationMinutes: 30, priceCents: 60000 })).body.id;
  doctorId = (await owner.post('/api/clinic/doctors', {
    displayName: 'Dr. Juan López', specialty: 'Cardiología', serviceIds: [serviceId],
  })).body.id;
  await owner.put(`/api/clinic/doctors/${doctorId}/schedule`, { rules: [{ weekday: 1, startMinute: 540, endMinute: 660 }] });
  monday = nextMonday();
});

function book(c: Client, time: string, requestId = randomUUID()) {
  return c.post(`${pub}/appointments`, { requestId, doctorId, serviceId, startsAt: localIso(monday, time) });
}

test('verificación de correo: obligatoria para reservar, enlace de un solo uso y reenvío', async () => {
  const ana = await registerPatient(h.base, 'Ana', { verified: false });
  const me = await ana.get('/api/patient/me');
  assert.equal(me.body.emailVerified, false);
  const [mail] = await h.deliver();
  assert.equal(mail.to, me.body.email);
  assert.match(mail.subject, /Confirma tu correo/);
  assert.match(mail.text, /\/verificar#/);
  assert.match(mail.html, /Confirmar mi correo/);

  const blocked = await book(ana, '09:00');
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.message, /Confirma tu correo/);

  const anon = new Client(h.base);
  assert.equal((await anon.post('/api/patient/auth/verify-email', { token: 'x'.repeat(64) })).status, 400);
  assert.equal((await anon.req('POST', '/api/patient/auth/verify-email', { token: linkToken(mail) }, { origin: 'https://evil.mx' })).status, 403);
  assert.equal((await anon.post('/api/patient/auth/verify-email', { token: linkToken(mail) })).status, 200);
  // Abrir el enlace otra vez (o en otro dispositivo) no falla.
  assert.equal((await anon.post('/api/patient/auth/verify-email', { token: linkToken(mail) })).status, 200);
  assert.equal((await ana.get('/api/patient/me')).body.emailVerified, true);
  assert.equal((await book(ana, '09:00')).status, 201);
  assert.match((await h.deliver())[0].subject, /Cita confirmada/);
  assert.equal((await ana.post('/api/patient/me/resend-verification')).status, 409);

  // Reenvío: el enlace anterior deja de servir.
  const beto = await registerPatient(h.base, 'Beto', { verified: false });
  const [first] = await h.deliver();
  assert.equal((await beto.post('/api/patient/me/resend-verification')).status, 204);
  const [second] = await h.deliver();
  assert.notEqual(linkToken(first), linkToken(second));
  assert.equal((await anon.post('/api/patient/auth/verify-email', { token: linkToken(first) })).status, 400);
  assert.equal((await anon.post('/api/patient/auth/verify-email', { token: linkToken(second) })).status, 200);

  // Un enlace vencido no sirve.
  const caro = await registerPatient(h.base, 'Caro', { verified: false });
  const [expired] = await h.deliver();
  await h.prisma.authToken.updateMany({ where: { kind: 'PATIENT_VERIFY_EMAIL', usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 2000) } });
  assert.equal((await anon.post('/api/patient/auth/verify-email', { token: linkToken(expired) })).status, 400);
  assert.equal((await caro.get('/api/patient/me')).body.emailVerified, false);
});

test('recuperación de contraseña del paciente: no revela cuentas, revoca sesiones y es de un solo uso', async () => {
  const ana = await registerPatient(h.base, 'Ana', { verified: false });
  const email = (await ana.get('/api/patient/me')).body.email;
  await h.deliver();
  const anon = new Client(h.base);

  assert.equal((await anon.post('/api/patient/auth/forgot', { email: 'nadie@test.mx' })).status, 204);
  assert.equal((await h.deliver()).length, 0);

  assert.equal((await anon.post('/api/patient/auth/forgot', { email: email.toUpperCase() })).status, 204);
  assert.equal((await anon.post('/api/patient/auth/forgot', { email })).status, 204);
  const sent = await h.deliver();
  assert.equal(sent.length, 2);
  assert.match(sent[0].subject, /Restablece tu contraseña/);
  assert.match(sent[0].text, /\/restablecer\?tipo=paciente#/);
  const [older, newer] = sent.map(linkToken);

  assert.equal((await anon.post('/api/patient/auth/reset', { token: newer, password: 'corta' })).status, 400);
  assert.equal((await anon.post('/api/patient/auth/reset', { token: newer, password: 'nueva-clave-segura' })).status, 204);
  assert.equal((await ana.get('/api/patient/me')).status, 401);
  assert.equal((await anon.post('/api/patient/auth/reset', { token: newer, password: 'otra-clave-segura' })).status, 400);
  // Restablecer invalida los demás enlaces pendientes.
  assert.equal((await anon.post('/api/patient/auth/reset', { token: older, password: 'otra-clave-segura' })).status, 400);

  const login = await anon.post('/api/patient/auth/login', { email, password: 'nueva-clave-segura' });
  assert.equal(login.status, 200);
  // El enlace llegó a su correo: queda confirmado.
  assert.equal(login.body.patient.emailVerified, true);
});

test('recuperación de contraseña del personal revoca sesiones en todas las clínicas', async () => {
  const anon = new Client(h.base);
  assert.equal((await anon.post('/api/auth/forgot', { email: ownerEmail })).status, 204);
  const [mail] = await h.deliver();
  assert.equal(mail.to, ownerEmail);
  assert.match(mail.text, /\/restablecer\?tipo=personal#/);
  // Un token de paciente no sirve para el personal ni al revés.
  assert.equal((await anon.post('/api/patient/auth/reset', { token: linkToken(mail), password: 'nueva-clave-segura' })).status, 400);
  assert.equal((await anon.post('/api/auth/reset', { token: linkToken(mail), password: 'corta-11ch' })).status, 400);
  assert.equal((await anon.post('/api/auth/reset', { token: linkToken(mail), password: 'propietario-nuevo-1' })).status, 204);
  assert.equal((await owner.get('/api/me')).status, 401);
  await loginStaff(h.base, ownerEmail, 'propietario-nuevo-1', SLUG);
});

test('invitaciones al personal: alta con contraseña propia, reenvío, revocación y vencimiento', async () => {
  const anon = new Client(h.base);
  const inv = await owner.post('/api/clinic/invitations', { name: 'Rosa', email: 'Rosa@Test.mx', role: 'RECEPTION' });
  assert.equal(inv.status, 201);
  assert.equal(inv.body.email, 'rosa@test.mx');
  const [mail] = await h.deliver();
  assert.equal(mail.to, 'rosa@test.mx');
  assert.match(mail.subject, /Te invitaron a Clínica clinica-a/);
  assert.match(mail.text, /Recepción/);
  assert.match(mail.text, /\/invitacion#/);
  assert.equal((await owner.get('/api/clinic/invitations')).body.length, 1);

  // Reenviar genera un enlace nuevo e invalida el anterior.
  assert.equal((await owner.post(`/api/clinic/invitations/${inv.body.id}/resend`)).status, 200);
  const [resent] = await h.deliver();
  const oldToken = linkToken(mail);
  const token = linkToken(resent);
  assert.equal((await anon.post('/api/auth/invitations/inspect', { token: oldToken })).status, 400);

  const info = await anon.post('/api/auth/invitations/inspect', { token });
  assert.equal(info.status, 200);
  assert.deepEqual(info.body, {
    clinic: { name: 'Clínica clinica-a', slug: SLUG }, name: 'Rosa', email: 'rosa@test.mx', role: 'RECEPTION', existingUser: false,
  });
  assert.equal((await anon.post('/api/auth/invitations/accept', { token })).status, 400);
  assert.equal((await anon.post('/api/auth/invitations/accept', { token, password: 'corta' })).status, 400);
  const accepted = await anon.post('/api/auth/invitations/accept', { token, password: 'recepcion-segura-1' });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.clinic.slug, SLUG);
  assert.equal((await anon.post('/api/auth/invitations/accept', { token, password: 'recepcion-segura-1' })).status, 400);
  const rosa = await loginStaff(h.base, 'rosa@test.mx', 'recepcion-segura-1', SLUG);
  assert.equal((await rosa.get('/api/me')).body.membership.role, 'RECEPTION');
  assert.equal((await owner.get('/api/clinic/invitations')).body.length, 0);
  // Recepción no puede invitar; invitar a alguien que ya es parte del equipo es un conflicto.
  assert.equal((await rosa.post('/api/clinic/invitations', { name: 'X', email: 'x@test.mx', role: 'DOCTOR' })).status, 403);
  assert.equal((await owner.post('/api/clinic/invitations', { name: 'Rosa', email: 'rosa@test.mx', role: 'DOCTOR' })).status, 409);

  // Revocar.
  const revoked = await owner.post('/api/clinic/invitations', { name: 'Leo', email: 'leo@test.mx', role: 'DOCTOR' });
  const [leoMail] = await h.deliver();
  assert.equal((await owner.post(`/api/clinic/invitations/${revoked.body.id}/revoke`)).status, 204);
  assert.equal((await anon.post('/api/auth/invitations/accept', { token: linkToken(leoMail), password: 'medico-seguro-01' })).status, 400);
  assert.equal((await owner.post(`/api/clinic/invitations/${revoked.body.id}/revoke`)).status, 404);

  // Vencida.
  await owner.post('/api/clinic/invitations', { name: 'Eva', email: 'eva@test.mx', role: 'DOCTOR' });
  const [evaMail] = await h.deliver();
  await h.prisma.staffInvitation.updateMany({ where: { email: 'eva@test.mx' }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await anon.post('/api/auth/invitations/accept', { token: linkToken(evaMail), password: 'medico-seguro-01' })).status, 400);
  assert.equal((await owner.get('/api/clinic/invitations')).body[0].expired, true);
});

test('una persona del personal puede unirse a otra clínica sin cambiar su contraseña', async () => {
  const other = await createClinicWithOwner(h.prisma, 'clinica-b');
  const ownerB = await loginStaff(h.base, other.email, other.password, 'clinica-b');
  await addStaff(h, owner, { name: 'Ana', email: 'ana@test.mx', role: 'DOCTOR', password: 'medica-segura-01' });
  await ownerB.post('/api/clinic/invitations', { name: 'Ana', email: 'ana@test.mx', role: 'ADMIN' });
  const [mail] = await h.deliver();
  const anon = new Client(h.base);
  assert.equal((await anon.post('/api/auth/invitations/inspect', { token: linkToken(mail) })).body.existingUser, true);
  // La contraseña enviada se ignora para cuentas existentes.
  const accepted = await anon.post('/api/auth/invitations/accept', { token: linkToken(mail), password: 'intento-de-cambio-1' });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.existingUser, true);
  const inB = await loginStaff(h.base, 'ana@test.mx', 'medica-segura-01', 'clinica-b');
  assert.equal((await inB.get('/api/me')).body.membership.role, 'ADMIN');
  await loginStaff(h.base, 'ana@test.mx', 'medica-segura-01', SLUG);
});

test('confirmaciones de cita con calendario: crear, reintento, reprogramar y cancelar', async () => {
  const ana = await registerPatient(h.base, 'Ana');
  await h.deliver();
  const requestId = randomUUID();
  const created = await book(ana, '09:00', requestId);
  assert.equal(created.status, 201);
  assert.equal((await book(ana, '09:00', requestId)).status, 201);
  const sent = await h.deliver();
  assert.equal(sent.length, 1, 'el reintento idempotente no envía otro correo');
  const [confirm] = sent;
  assert.match(confirm.subject, /^Cita confirmada: lunes \d+ de \w+ de \d{4} a las 09:00 h$/);
  assert.match(confirm.text, /Dr\. Juan López/);
  assert.match(confirm.text, /\$600\.00/);
  assert.match(confirm.text, /\/paciente/);
  const ics = confirm.attachments![0];
  assert.equal(ics.filename, 'cita.ics');
  assert.match(ics.content, /METHOD:PUBLISH/);
  assert.match(ics.content, new RegExp(`UID:${created.body.appointment.id}@medora`));
  assert.match(ics.content, /SEQUENCE:0/);
  assert.match(ics.content, /DTSTART:\d{8}T\d{6}Z/);

  const id = created.body.appointment.id;
  const moved = await ana.post(`/api/patient/appointments/${id}/reschedule`, {
    startsAt: localIso(monday, '10:00'), expectedStartsAt: created.body.appointment.startsAt,
  });
  assert.equal(moved.status, 200);
  const [resched] = await h.deliver();
  assert.match(resched.subject, /^Cita reprogramada: .* 10:00 h$/);
  assert.match(resched.text, /Antes: .* 09:00 h/);
  assert.match(resched.attachments![0].content, /SEQUENCE:1/);

  assert.equal((await ana.post(`/api/patient/appointments/${id}/cancel`, { reason: 'Viaje' })).status, 200);
  assert.equal((await ana.post(`/api/patient/appointments/${id}/cancel`, { reason: 'Viaje' })).status, 200);
  const cancelled = await h.deliver();
  assert.equal(cancelled.length, 1, 'cancelar dos veces envía un solo correo');
  assert.match(cancelled[0].subject, /^Cita cancelada: .* 10:00 h$/);
  assert.match(cancelled[0].text, /Motivo: Viaje/);
  const cancelIcs = cancelled[0].attachments![0].content;
  assert.match(cancelIcs, /METHOD:CANCEL/);
  assert.match(cancelIcs, /STATUS:CANCELLED/);
  assert.match(cancelIcs, /SEQUENCE:2/);
});

test('citas por teléfono: correo sólo si la ficha tiene correo y sin enlace al portal', async () => {
  const sinCorreo = await owner.post('/api/clinic/patients', { name: 'Don Pepe', phone: '33 1111 2222' });
  const conCorreo = await owner.post('/api/clinic/patients', { name: 'Doña Luz', phone: '33 3333 4444', email: 'luz@test.mx' });
  for (const [p, time] of [[sinCorreo, '09:00'], [conCorreo, '09:30']] as const) {
    const r = await owner.post('/api/clinic/appointments', {
      requestId: randomUUID(), doctorId, serviceId, clinicPatientId: p.body.id, startsAt: localIso(monday, time),
    });
    assert.equal(r.status, 201);
  }
  const sent = await h.deliver();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'luz@test.mx');
  assert.doesNotMatch(sent[0].text, /\/paciente/);
  assert.match(sent[0].text, /comunícate con la clínica/);
});

test('cola: reintenta tras un fallo SMTP, no duplica con trabajadores concurrentes y retoma trabajos abandonados', async () => {
  await registerPatient(h.base, 'Ana', { verified: false });
  h.mail.failNext = 1;
  assert.equal((await h.deliver()).length, 0);
  const failed = await h.prisma.job.findFirstOrThrow();
  assert.equal(failed.attempts, 1);
  assert.match(failed.lastError!, /Fallo simulado/);
  assert.ok(failed.runAt > new Date(), 'se reprograma con espera');
  assert.equal(failed.completedAt, null);
  // Al vencer la espera se reenvía y el cuerpo deja de guardarse.
  await h.jobs.runOnce(new Date(Date.now() + 60 * 60_000));
  assert.equal(h.mail.sent.length, 1);
  const done = await h.prisma.job.findUniqueOrThrow({ where: { id: failed.id } });
  assert.ok(done.completedAt);
  assert.deepEqual(Object.keys(done.payload as object).sort(), ['subject', 'to']);

  // Diez trabajadores a la vez: cada correo sale una sola vez.
  for (const n of ['B1', 'B2', 'B3']) await registerPatient(h.base, n, { verified: false });
  const before = h.mail.sent.length;
  await Promise.all(Array.from({ length: 10 }, () => h.jobs.runOnce()));
  assert.equal(h.mail.sent.length - before, 3);

  // Un trabajador que murió con el trabajo reservado: otro lo retoma al vencer el arrendamiento.
  await registerPatient(h.base, 'Caída', { verified: false });
  const orphan = await h.prisma.job.findFirstOrThrow({ where: { completedAt: null } });
  await h.prisma.job.update({ where: { id: orphan.id }, data: { attempts: 1, lockedUntil: new Date(Date.now() + 60_000) } });
  assert.equal((await h.deliver()).length, 0, 'mientras esté reservado nadie más lo toma');
  await h.prisma.job.update({ where: { id: orphan.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
  assert.equal((await h.deliver()).length, 1);
});

test('cola: se rinde tras el máximo de intentos y no encola dos veces la misma clave', async () => {
  await registerPatient(h.base, 'Ana', { verified: false });
  await h.prisma.job.updateMany({ data: { maxAttempts: 2 } });
  h.mail.failNext = 5;
  await h.jobs.runOnce();
  await h.jobs.runOnce(new Date(Date.now() + 2 * 60 * 60_000));
  const job = await h.prisma.job.findFirstOrThrow();
  assert.equal(job.attempts, 2);
  assert.ok(job.failedAt);
  assert.equal(await h.jobs.runOnce(new Date(Date.now() + 10 * 60 * 60_000)), 0);

  const payload = { to: 'a@test.mx', subject: 'x', text: 'x', html: 'x' };
  await h.jobs.enqueue(h.prisma as never, { type: 'email.send', payload, dedupeKey: 'misma' });
  await h.jobs.enqueue(h.prisma as never, { type: 'email.send', payload, dedupeKey: 'misma' });
  assert.equal(await h.prisma.job.count({ where: { dedupeKey: 'misma' } }), 1);
});
