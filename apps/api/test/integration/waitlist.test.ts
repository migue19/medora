import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Client, Harness, createClinicWithOwner, linkToken, localIso, loginStaff, nextMonday, randomUUID, registerPatient,
  resetDb, startHarness,
} from './harness';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const SLUG = 'clinica-a';
const pub = `/api/public/clinics/${SLUG}`;
let owner: Client;
let doctorId: string;
let serviceId: string;
let monday: string;

beforeEach(async () => {
  await resetDb(h.prisma);
  h.mail.sent.length = 0;
  const created = await createClinicWithOwner(h.prisma, SLUG);
  owner = await loginStaff(h.base, created.email, created.password, SLUG);
  serviceId = (await owner.post('/api/clinic/services', { name: 'Consulta', durationMinutes: 30, priceCents: 60000 })).body.id;
  doctorId = (await owner.post('/api/clinic/doctors', { displayName: 'Dr. Juan', specialty: 'Cardiología', serviceIds: [serviceId] })).body.id;
  await owner.put(`/api/clinic/doctors/${doctorId}/schedule`, { rules: [{ weekday: 1, startMinute: 540, endMinute: 660 }] });
  monday = nextMonday();
});

function book(c: Client, time: string, requestId = randomUUID()) {
  return c.post(`${pub}/appointments`, { requestId, doctorId, serviceId, startsAt: localIso(monday, time) });
}

async function slots(): Promise<string[]> {
  const r = await new Client(h.base).get(`${pub}/doctors/${doctorId}/availability?serviceId=${serviceId}&from=${monday}&days=1`);
  return r.body.days[0].slots.map((s: { time: string }) => s.time);
}

const offerMails = <T extends { subject: string }>(mails: T[]) => mails.filter((m) => /Se liberó un horario/.test(m.subject));

/** Paciente con una cita a esa hora que luego cancela para liberar el horario. */
async function bookedThenCancel(time: string) {
  const beto = await registerPatient(h.base, 'Beto');
  const r = await book(beto, time);
  assert.equal(r.status, 201);
  return async () => {
    assert.equal((await beto.post(`/api/patient/appointments/${r.body.appointment.id}/cancel`, {})).status, 200);
  };
}

async function join(c: Client, extra: object = {}) {
  return c.post(`${pub}/waitlist`, { doctorId, serviceId, ...extra });
}

test('anotarse en la lista: correo confirmado, sin duplicados, máximo 3 y salir', async () => {
  const ana = await registerPatient(h.base, 'Ana', { verified: false });
  assert.equal((await join(ana)).status, 403);
  await h.prisma.patientAccount.updateMany({ data: { emailVerifiedAt: new Date() } });
  const entry = await join(ana, { fromDate: monday, toDate: monday, notes: 'Por la mañana' });
  assert.equal(entry.status, 201);
  assert.equal((await join(ana)).status, 409);
  assert.equal((await join(ana, { fromDate: '2026-12-31', toDate: '2026-01-01' })).status, 400);
  const extra = [];
  for (const n of ['A', 'B', 'C']) {
    extra.push((await owner.post('/api/clinic/services', { name: `S${n}`, durationMinutes: 30, priceCents: 0 })).body.id);
  }
  await owner.patch(`/api/clinic/doctors/${doctorId}`, { serviceIds: [serviceId, ...extra] });
  assert.equal((await ana.post(`${pub}/waitlist`, { doctorId, serviceId: extra[0] })).status, 201);
  assert.equal((await ana.post(`${pub}/waitlist`, { doctorId, serviceId: extra[1] })).status, 201);
  assert.equal((await ana.post(`${pub}/waitlist`, { doctorId, serviceId: extra[2] })).status, 409);

  const mine = await ana.get('/api/patient/waitlist');
  assert.equal(mine.body.length, 3);
  assert.equal(mine.body[0].doctor.displayName, 'Dr. Juan');
  assert.equal((await ana.post(`/api/patient/waitlist/${entry.body.id}/leave`)).status, 204);
  assert.equal((await ana.get('/api/patient/waitlist')).body.length, 2);
  assert.equal((await owner.get('/api/clinic/waitlist')).body.length, 2);
});

test('al cancelarse una cita se aparta el horario al primero de la lista y él lo acepta', async () => {
  const cancel = await bookedThenCancel('09:00');
  const ana = await registerPatient(h.base, 'Ana');
  const caro = await registerPatient(h.base, 'Caro');
  await join(ana);
  await join(caro);
  await h.deliver();
  await cancel();
  const sent = await h.deliver();
  const offers = offerMails(sent);
  assert.equal(offers.length, 1);
  const anaEmail = (await ana.get('/api/patient/me')).body.email;
  assert.equal(offers[0].to, anaEmail);
  assert.match(offers[0].text, /\/lista-espera#/);
  assert.match(offers[0].text, /Lo apartamos para ti hasta las/);
  const token = linkToken(offers[0]);

  // Mientras está apartado nadie más lo ve ni lo puede tomar, tampoco recepción.
  assert.ok(!(await slots()).includes('09:00'));
  assert.equal((await book(caro, '09:00')).status, 409);
  const phone = await owner.post('/api/clinic/patients', { name: 'Don Pepe', phone: '33 1111 2222' });
  const staffTry = await owner.post('/api/clinic/appointments', {
    requestId: randomUUID(), doctorId, serviceId, clinicPatientId: phone.body.id, startsAt: localIso(monday, '09:00'),
  });
  assert.equal(staffTry.status, 409);
  assert.match(staffTry.body.message, /apartado para una persona de la lista de espera/);
  const list = (await owner.get('/api/clinic/waitlist')).body;
  assert.equal(list[0].clinicPatient.name, 'Ana');
  assert.ok(list[0].offer);
  assert.equal(list[1].offer, null);

  const anon = new Client(h.base);
  const info = await anon.post('/api/public/waitlist-offers/inspect', { token });
  assert.equal(info.body.open, true);
  assert.equal(info.body.doctor.displayName, 'Dr. Juan');
  // Dos clics simultáneos en «Aceptar» crean una sola cita.
  const [r1, r2] = await Promise.all([
    anon.post('/api/public/waitlist-offers/accept', { token }),
    anon.post('/api/public/waitlist-offers/accept', { token }),
  ]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r1.body.appointment.id, r2.body.appointment.id);
  const anaAppts = (await ana.get('/api/patient/appointments')).body.upcoming;
  assert.equal(anaAppts.length, 1);
  assert.match((await h.deliver()).map((m) => m.subject).join('|'), /Cita confirmada/);
  assert.equal((await owner.get('/api/clinic/waitlist')).body.length, 1, 'Ana sale de la lista');
  assert.equal((await anon.post('/api/public/waitlist-offers/inspect', { token })).body.status, 'ACCEPTED');
  assert.equal((await anon.post('/api/public/waitlist-offers/decline', { token })).status, 400);
});

test('si rechaza o no responde, el horario pasa al siguiente; el rango de fechas se respeta', async () => {
  const cancel = await bookedThenCancel('09:00');
  const lejos = await registerPatient(h.base, 'Lejos');
  const ana = await registerPatient(h.base, 'Ana');
  const caro = await registerPatient(h.base, 'Caro');
  await join(lejos, { toDate: '2026-01-31' }); // Su rango ya pasó: no se le ofrece.
  await join(ana);
  await join(caro);
  await h.deliver();
  await cancel();
  const [toAna] = offerMails(await h.deliver());
  assert.equal(toAna.to, (await ana.get('/api/patient/me')).body.email);

  assert.equal((await new Client(h.base).post('/api/public/waitlist-offers/decline', { token: linkToken(toAna) })).status, 204);
  const [toCaro] = offerMails(await h.deliver());
  assert.equal(toCaro.to, (await caro.get('/api/patient/me')).body.email);
  // Ana rechazó ese horario pero sigue en la lista para el siguiente.
  assert.equal((await owner.get('/api/clinic/waitlist')).body.length, 3);

  // Caro no responde: al vencer, se libera; ya no queda nadie compatible y el horario vuelve a estar libre.
  await h.prisma.waitlistOffer.updateMany({ where: { status: 'PENDING' }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.ok((await slots()).includes('09:00'));
  await h.jobs.runOnce(new Date(Date.now() + 3 * 3600_000));
  const statuses = (await h.prisma.waitlistOffer.findMany({ orderBy: { createdAt: 'asc' } })).map((o) => o.status);
  assert.deepEqual(statuses, ['DECLINED', 'EXPIRED']);
  assert.equal(offerMails(h.mail.sent).length, 2);
});

test('pacientes telefónicos: recepción ve el apartado, lo agenda o lo libera', async () => {
  const pepe = await owner.post('/api/clinic/patients', { name: 'Don Pepe', phone: '33 1111 2222' });
  const luz = await owner.post('/api/clinic/patients', { name: 'Doña Luz', phone: '33 3333 4444' });
  for (const p of [pepe, luz]) {
    assert.equal((await owner.post('/api/clinic/waitlist', { clinicPatientId: p.body.id, doctorId, serviceId })).status, 201);
  }
  const cancel = await bookedThenCancel('09:30');
  await cancel();
  await h.deliver();
  let list = (await owner.get('/api/clinic/waitlist')).body;
  assert.equal(list[0].clinicPatient.name, 'Don Pepe');
  const firstOffer = list[0].offer;
  assert.ok(firstOffer, 'sin correo igual se aparta y recepción lo ve');

  // Pepe dijo por teléfono que no puede: recepción libera y pasa a Luz.
  assert.equal((await owner.post(`/api/clinic/waitlist/offers/${firstOffer.id}/release`)).status, 204);
  await h.deliver();
  list = (await owner.get('/api/clinic/waitlist')).body;
  const luzOffer = list.find((e: { clinicPatient: { name: string } }) => e.clinicPatient.name === 'Doña Luz').offer;
  assert.ok(luzOffer);
  const booked = await owner.post(`/api/clinic/waitlist/offers/${luzOffer.id}/accept`);
  assert.equal(booked.status, 200);
  assert.equal(booked.body.source, 'STAFF');
  assert.equal(booked.body.clinicPatientId, luz.body.id);
  assert.equal((await owner.get('/api/clinic/waitlist')).body.length, 1);
});

test('reprogramar libera el horario anterior y salir de la lista libera el apartado', async () => {
  const beto = await registerPatient(h.base, 'Beto');
  const appt = (await book(beto, '09:00')).body.appointment;
  const ana = await registerPatient(h.base, 'Ana');
  const caro = await registerPatient(h.base, 'Caro');
  const anaEntry = (await join(ana)).body;
  await join(caro);
  await h.deliver();
  const moved = await beto.post(`/api/patient/appointments/${appt.id}/reschedule`, {
    startsAt: localIso(monday, '10:30'), expectedStartsAt: appt.startsAt,
  });
  assert.equal(moved.status, 200);
  assert.equal(offerMails(await h.deliver()).length, 1, 'el 09:00 se ofrece a Ana');
  assert.equal((await ana.post(`/api/patient/waitlist/${anaEntry.id}/leave`)).status, 204);
  const [toCaro] = offerMails(await h.deliver());
  assert.equal(toCaro.to, (await caro.get('/api/patient/me')).body.email);
  const released = await h.prisma.waitlistOffer.findFirstOrThrow({ where: { entryId: anaEntry.id } });
  assert.equal(released.status, 'RELEASED');
});
