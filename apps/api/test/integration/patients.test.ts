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
let owner: Client;
let doctorId: string;
let otherDoctorId: string;
let serviceId: string;
let monday: string;

beforeEach(async () => {
  await resetDb(h.prisma);
  h.mail.sent.length = 0;
  const created = await createClinicWithOwner(h.prisma, SLUG);
  owner = await loginStaff(h.base, created.email, created.password, SLUG);
  serviceId = (await owner.post('/api/clinic/services', { name: 'Consulta', durationMinutes: 30, priceCents: 60000 })).body.id;
  doctorId = (await owner.post('/api/clinic/doctors', { displayName: 'Dr. Juan', specialty: 'Cardiología', serviceIds: [serviceId] })).body.id;
  otherDoctorId = (await owner.post('/api/clinic/doctors', { displayName: 'Dra. Ana', specialty: 'Pediatría', serviceIds: [serviceId] })).body.id;
  for (const id of [doctorId, otherDoctorId]) {
    await owner.put(`/api/clinic/doctors/${id}/schedule`, { rules: [{ weekday: 1, startMinute: 540, endMinute: 720 }] });
  }
  monday = nextMonday();
});

async function phonePatient(name: string, extra: object = {}) {
  const r = await owner.post('/api/clinic/patients', { name, phone: '33 1111 2222', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as { id: string };
}

async function staffBook(clinicPatientId: string, time: string, doc = doctorId, extra: object = {}) {
  const r = await owner.post('/api/clinic/appointments', {
    requestId: randomUUID(), doctorId: doc, serviceId, clinicPatientId, startsAt: localIso(monday, time), ...extra,
  });
  return r;
}

/** Lleva una cita al pasado con un resultado (no se puede atender una cita futura). */
async function makePast(appointmentId: string, status: 'COMPLETED' | 'NO_SHOW', daysAgo: number) {
  const start = new Date(Date.now() - daysAgo * 24 * 3600_000);
  await h.prisma.appointment.update({
    where: { id: appointmentId }, data: { status, startsAt: start, endsAt: new Date(start.getTime() + 30 * 60_000) },
  });
}

test('perfil del paciente: historial, inasistencias, notas, etiquetas y edición auditada', async () => {
  const pepe = await phonePatient('Don Pepe');
  const a1 = (await staffBook(pepe.id, '09:00')).body;
  const a2 = (await staffBook(pepe.id, '10:00')).body;
  const a3 = (await staffBook(pepe.id, '11:00')).body;
  await makePast(a1.id, 'COMPLETED', 30);
  await makePast(a2.id, 'NO_SHOW', 10);
  await owner.post(`/api/clinic/appointments/${a3.id}/cancel`, { reason: 'Llamó para cancelar' });
  await staffBook(pepe.id, '11:30');

  const rec = await addStaff(h, owner, { name: 'Rosa', email: 'rosa@test.mx', role: 'RECEPTION', password: 'recepcion-segura-1' });
  void rec;
  const rosa = await loginStaff(h.base, 'rosa@test.mx', 'recepcion-segura-1', SLUG);
  assert.equal((await rosa.post(`/api/clinic/patients/${pepe.id}/notes`, { body: 'Prefiere citas temprano' })).status, 201);
  const upd = await rosa.patch(`/api/clinic/patients/${pepe.id}`, { name: 'José «Pepe» Ruiz', tags: [' Diabetes ', 'VIP', 'vip'] });
  assert.equal(upd.status, 200);
  assert.deepEqual(upd.body.tags, ['diabetes', 'vip']);
  assert.equal((await rosa.patch(`/api/clinic/patients/${pepe.id}`, { tags: ['x'.repeat(31)] })).status, 400);

  const profile = await rosa.get(`/api/clinic/patients/${pepe.id}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.patient.name, 'José «Pepe» Ruiz');
  assert.deepEqual(profile.body.stats, { total: 4, upcoming: 1, completed: 1, noShow: 1, cancelled: 1 });
  assert.equal(profile.body.appointments.length, 4);
  assert.equal(profile.body.notes[0].body, 'Prefiere citas temprano');
  assert.equal(profile.body.notes[0].authorName, 'Rosa');
  assert.deepEqual(profile.body.audit.map((a: { action: string }) => a.action), ['UPDATED', 'CREATED']);
  assert.deepEqual(profile.body.audit[0].details.name, ['Don Pepe', 'José «Pepe» Ruiz']);

  // Búsqueda por etiqueta.
  const found = await rosa.get('/api/clinic/patients?q=diabetes');
  assert.deepEqual(found.body.map((p: { id: string }) => p.id), [pepe.id]);

  // El médico sólo ve pacientes con citas suyas, y sólo sus citas.
  const docMember = await addStaff(h, owner, { name: 'Dra', email: 'dra@test.mx', role: 'DOCTOR', password: 'medica-segura-001' });
  await owner.patch(`/api/clinic/doctors/${otherDoctorId}`, { membershipId: docMember.membershipId });
  const dra = await loginStaff(h.base, 'dra@test.mx', 'medica-segura-001', SLUG);
  assert.equal((await dra.get(`/api/clinic/patients/${pepe.id}`)).status, 404);
  assert.equal((await dra.post(`/api/clinic/patients/${pepe.id}/notes`, { body: 'x' })).status, 404);
  await staffBook(pepe.id, '09:00', otherDoctorId);
  const seen = await dra.get(`/api/clinic/patients/${pepe.id}`);
  assert.equal(seen.status, 200);
  assert.equal(seen.body.appointments.length, 1);
  assert.deepEqual(seen.body.audit, []);
  assert.equal((await dra.patch(`/api/clinic/patients/${pepe.id}`, { name: 'X' })).status, 403);
});

test('fusionar fichas duplicadas mueve citas, notas y etiquetas y queda auditado', async () => {
  const a = await phonePatient('Pepe Ruiz', { email: null });
  const b = await phonePatient('José Ruiz', { email: 'jose@test.mx' });
  await owner.patch(`/api/clinic/patients/${a.id}`, { tags: ['vip'] });
  await owner.patch(`/api/clinic/patients/${b.id}`, { tags: ['diabetes'] });
  await staffBook(a.id, '09:00');
  await staffBook(b.id, '10:00');
  await owner.post(`/api/clinic/patients/${b.id}/notes`, { body: 'Nota en la duplicada' });

  // Citas vigentes a la misma hora con distintos médicos: no se puede fusionar.
  const clash = await staffBook(b.id, '09:00', otherDoctorId);
  assert.equal(clash.status, 201);
  assert.equal((await owner.post(`/api/clinic/patients/${a.id}/merge`, { sourceId: b.id })).status, 409);
  await owner.post(`/api/clinic/appointments/${clash.body.id}/cancel`, { reason: 'Duplicada' });
  assert.equal((await owner.post(`/api/clinic/patients/${a.id}/merge`, { sourceId: a.id })).status, 400);

  const merged = await owner.post(`/api/clinic/patients/${a.id}/merge`, { sourceId: b.id });
  assert.equal(merged.status, 200);
  assert.equal(merged.body.appointmentsMoved, 2);
  assert.equal(merged.body.patient.email, 'jose@test.mx');
  assert.deepEqual(merged.body.patient.tags.sort(), ['diabetes', 'vip']);
  assert.equal(merged.body.appointments.length, 3);
  assert.equal(merged.body.notes[0].body, 'Nota en la duplicada');
  assert.equal(merged.body.audit[0].action, 'MERGED');
  assert.equal(merged.body.audit[0].details.source.name, 'José Ruiz');
  // La ficha origen desaparece de la búsqueda y de la agenda nueva.
  assert.equal((await owner.get(`/api/clinic/patients/${b.id}`)).status, 404);
  assert.deepEqual((await owner.get('/api/clinic/patients?q=Ruiz')).body.map((p: { id: string }) => p.id), [a.id]);
  assert.equal((await staffBook(b.id, '11:00')).status, 404);
});

test('vincular una ficha telefónica con la cuenta en línea fusiona la ficha creada al reservar', async () => {
  const pepe = await phonePatient('Pepe');
  const past = (await staffBook(pepe.id, '09:00')).body;
  await makePast(past.id, 'COMPLETED', 20);
  const ana = await registerPatient(h.base, 'Ana');
  const anaEmail = (await ana.get('/api/patient/me')).body.email;
  const online = await ana.post(`/api/public/clinics/${SLUG}/appointments`, {
    requestId: randomUUID(), doctorId, serviceId, startsAt: localIso(monday, '10:00'),
  });
  assert.equal(online.status, 201);
  assert.equal((await owner.get('/api/clinic/patients')).body.length, 2);
  await h.deliver();

  assert.equal((await owner.post(`/api/clinic/patients/${pepe.id}/link`, { email: 'nadie@test.mx' })).status, 404);
  const req = await owner.post(`/api/clinic/patients/${pepe.id}/link`, { email: anaEmail.toUpperCase() });
  assert.equal(req.status, 200);
  const [mail] = await h.deliver();
  assert.equal(mail.to, anaEmail);
  assert.match(mail.subject, /quiere vincular tu expediente/);
  const token = linkToken(mail);
  assert.match(mail.text, /\/vincular#/);

  const anon = new Client(h.base);
  const info = await anon.post('/api/public/patient-links/inspect', { token });
  assert.deepEqual(info.body, { clinic: { name: 'Clínica clinica-a' }, patientName: 'Pepe', phoneEnd: '2222', upcoming: 0 });
  const accepted = await anon.post('/api/public/patient-links/accept', { token });
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.body, { linked: true, merged: true });
  assert.equal((await anon.post('/api/public/patient-links/accept', { token })).status, 400);

  const list = (await owner.get('/api/clinic/patients')).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].id, pepe.id);
  assert.equal(list[0].linked, true);
  // Con cuenta en línea los datos de contacto son los del paciente.
  assert.equal(list[0].email, anaEmail);
  const mine = (await ana.get('/api/patient/appointments')).body;
  assert.equal(mine.upcoming.length, 1);
  assert.equal(mine.past.length, 1);
  const profile = (await owner.get(`/api/clinic/patients/${pepe.id}`)).body;
  assert.deepEqual(profile.audit.slice(0, 3).map((a: { action: string }) => a.action), ['LINKED', 'MERGED', 'LINK_REQUESTED']);
  // La ficha vinculada ya no la edita la clínica, pero sí sus etiquetas.
  assert.equal((await owner.patch(`/api/clinic/patients/${pepe.id}`, { phone: '55 0000 0000' })).status, 403);
  assert.equal((await owner.patch(`/api/clinic/patients/${pepe.id}`, { tags: ['vinculada'] })).status, 200);
  // Lo que el paciente cambia en su perfil llega a la clínica.
  await ana.patch('/api/patient/me', { name: 'Ana María', phone: '55 9999 8888' });
  assert.equal((await owner.get(`/api/clinic/patients/${pepe.id}`)).body.patient.name, 'Ana María');
  assert.equal((await owner.post(`/api/clinic/patients/${pepe.id}/link`, { email: anaEmail })).status, 409);
});

test('cita subsecuente desde una cita atendida', async () => {
  const pepe = await phonePatient('Pepe');
  const first = (await staffBook(pepe.id, '09:00')).body;
  assert.equal((await staffBook(pepe.id, '10:00', doctorId, { followUpOfId: first.id })).status, 400);
  await makePast(first.id, 'COMPLETED', 7);
  const next = await staffBook(pepe.id, '10:00', doctorId, { followUpOfId: first.id });
  assert.equal(next.status, 201);
  assert.equal(next.body.followUpOfId, first.id);
  const other = await phonePatient('Otro');
  assert.equal((await staffBook(other.id, '11:00', doctorId, { followUpOfId: first.id })).status, 404);
  const agenda = await owner.get(`/api/clinic/appointments?from=${monday}&days=1`);
  assert.equal(agenda.body.appointments.find((a: { id: string }) => a.id === next.body.id).followUpOfId, first.id);
});
