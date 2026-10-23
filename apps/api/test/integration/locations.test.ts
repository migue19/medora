import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import {
  Client, Harness, ORIGIN, createClinicWithOwner, localIso, loginStaff, nextMonday, randomUUID, registerPatient,
  resetDb, startHarness,
} from './harness';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const SLUG = 'clinica-a';
const pub = `/api/public/clinics/${SLUG}`;
let owner: Client;
let serviceId: string;
let doctorId: string;
let otherDoctorId: string;
let norte: { id: string; rooms: { id: string; name: string }[] };
let sur: { id: string; rooms: { id: string; name: string }[] };
let monday: string;
let wednesday: string;

const hours = (weekdays: number[], start: number, end: number) =>
  weekdays.map((weekday) => ({ weekday, startMinute: start, endMinute: end }));

beforeEach(async () => {
  await resetDb(h.prisma);
  const created = await createClinicWithOwner(h.prisma, SLUG);
  owner = await loginStaff(h.base, created.email, created.password, SLUG);
  serviceId = (await owner.post('/api/clinic/services', { name: 'Consulta', durationMinutes: 30, priceCents: 60000 })).body.id;
  doctorId = (await owner.post('/api/clinic/doctors', { displayName: 'Dr. Juan', specialty: 'Cardiología', serviceIds: [serviceId] })).body.id;
  otherDoctorId = (await owner.post('/api/clinic/doctors', { displayName: 'Dra. Ana', specialty: 'Pediatría', serviceIds: [serviceId] })).body.id;

  const n = await owner.post('/api/clinic/locations', { name: 'Sede Norte', address: 'Av. Norte 100', mapUrl: 'https://maps.google.com/?q=norte' });
  assert.equal(n.status, 201);
  assert.equal((await owner.post('/api/clinic/locations', { name: 'Sede Norte' })).status, 409);
  assert.equal((await owner.post('/api/clinic/locations', { name: 'Mal', mapUrl: 'javascript:alert(1)' })).status, 400);
  await owner.put(`/api/clinic/locations/${n.body.id}/hours`, { hours: hours([1, 2, 3, 4, 5], 480, 840) });
  norte = (await owner.post(`/api/clinic/locations/${n.body.id}/rooms`, { name: 'Consultorio 1' })).body;
  norte = (await owner.post(`/api/clinic/locations/${n.body.id}/rooms`, { name: 'Consultorio 2' })).body;
  const s = await owner.post('/api/clinic/locations', { name: 'Sede Sur', address: 'Calle Sur 5' });
  await owner.put(`/api/clinic/locations/${s.body.id}/hours`, { hours: hours([3], 900, 1200) });
  sur = (await owner.post(`/api/clinic/locations/${s.body.id}/rooms`, { name: 'Consultorio A' })).body;

  monday = nextMonday();
  wednesday = DateTime.fromISO(monday).plus({ days: 2 }).toISODate()!;
});

const room = (loc: typeof norte, name: string) => loc.rooms.find((r) => r.name === name)!.id;

async function scheduleJuan() {
  const r = await owner.put(`/api/clinic/doctors/${doctorId}/schedule`, {
    rules: [
      { weekday: 1, startMinute: 540, endMinute: 660, locationId: norte.id, roomId: room(norte, 'Consultorio 1') },
      { weekday: 3, startMinute: 960, endMinute: 1020, locationId: sur.id, roomId: room(sur, 'Consultorio A') },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

async function slots(date: string, locationId?: string, doc = doctorId) {
  const q = new URLSearchParams({ serviceId, from: date, days: '1', ...(locationId ? { locationId } : {}) });
  const r = await new Client(h.base).get(`${pub}/doctors/${doc}/availability?${q}`);
  assert.equal(r.status, 200);
  return r.body.days[0].slots as { time: string; locationId: string }[];
}

test('un médico atiende en dos sedes con horarios distintos y cada cita toma su sede y consultorio', async () => {
  await scheduleJuan();
  const profile = (await new Client(h.base).get(pub)).body;
  assert.deepEqual(profile.locations.map((l: { name: string }) => l.name), ['Sede Norte', 'Sede Sur']);
  assert.equal(profile.locations[0].mapUrl, 'https://maps.google.com/?q=norte');
  assert.equal(profile.locations[1].hours[0].weekday, 3);
  const juan = profile.doctors.find((d: { id: string }) => d.id === doctorId);
  assert.deepEqual(juan.locationIds.sort(), [norte.id, sur.id].sort());

  const mon = await slots(monday);
  assert.deepEqual(mon.map((s) => s.time), ['09:00', '09:30', '10:00', '10:30']);
  assert.ok(mon.every((s) => s.locationId === norte.id));
  assert.deepEqual((await slots(wednesday)).map((s) => [s.time, s.locationId]), [['16:00', sur.id], ['16:30', sur.id]]);
  assert.equal((await slots(monday, sur.id)).length, 0);

  const ana = await registerPatient(h.base, 'Ana');
  const booked = await ana.post(`${pub}/appointments`, { requestId: randomUUID(), doctorId, serviceId, startsAt: localIso(monday, '09:00') });
  assert.equal(booked.status, 201);
  assert.equal(booked.body.appointment.locationId, norte.id);
  assert.equal(booked.body.appointment.roomId, room(norte, 'Consultorio 1'));
  const [confirm] = (await h.deliver()).filter((m) => /Cita confirmada/.test(m.subject));
  assert.match(confirm.text, /Dirección: Sede Norte, Av\. Norte 100/);

  const moved = await owner.post(`/api/clinic/appointments/${booked.body.appointment.id}/reschedule`, {
    startsAt: localIso(wednesday, '16:30'), expectedStartsAt: booked.body.appointment.startsAt,
  });
  assert.equal(moved.status, 200);
  const agenda = await owner.get(`/api/clinic/appointments?from=${wednesday}&days=1&locationId=${sur.id}`);
  assert.equal(agenda.body.appointments.length, 1);
  assert.deepEqual(agenda.body.appointments[0].location, { id: sur.id, name: 'Sede Sur' });
  assert.equal(agenda.body.appointments[0].room.name, 'Consultorio A');
  assert.equal((await owner.get(`/api/clinic/appointments?from=${wednesday}&days=1&locationId=${norte.id}`)).body.appointments.length, 0);
  const portal = (await ana.get('/api/patient/appointments')).body.upcoming[0];
  assert.equal(portal.location.name, 'Sede Sur');
});

test('validaciones del horario por sede y consultorio', async () => {
  const put = (rules: object[], doc = doctorId) => owner.put(`/api/clinic/doctors/${doc}/schedule`, { rules });
  // Fuera del horario de la sede (Sur sólo atiende miércoles de 15 a 20 h).
  assert.equal((await put([{ weekday: 1, startMinute: 540, endMinute: 600, locationId: sur.id }])).status, 400);
  // Consultorio de otra sede.
  assert.equal((await put([{ weekday: 1, startMinute: 540, endMinute: 600, locationId: norte.id, roomId: room(sur, 'Consultorio A') }])).status, 400);
  await scheduleJuan();
  // Otro médico en el mismo consultorio y horario traslapado: rechazado; en otro consultorio, permitido.
  const clash = await put([{ weekday: 1, startMinute: 600, endMinute: 720, locationId: norte.id, roomId: room(norte, 'Consultorio 1') }], otherDoctorId);
  assert.equal(clash.status, 409);
  assert.match(clash.body.message, /consultorio ya está asignado/);
  assert.equal((await put([{ weekday: 1, startMinute: 600, endMinute: 720, locationId: norte.id, roomId: room(norte, 'Consultorio 2') }], otherDoctorId)).status, 200);
  // La sede no puede reducir su horario dejando fuera a un médico, ni desactivarse con horarios.
  assert.equal((await owner.put(`/api/clinic/locations/${sur.id}/hours`, { hours: hours([3], 900, 990) })).status, 409);
  assert.equal((await owner.patch(`/api/clinic/locations/${sur.id}`, { active: false })).status, 409);
  assert.equal((await owner.patch(`/api/clinic/rooms/${room(norte, 'Consultorio 2')}`, { active: false })).status, 409);
  assert.equal((await owner.put(`/api/clinic/locations/${sur.id}/hours`, { hours: [...hours([3], 900, 1000), ...hours([3], 960, 1200)] })).status, 400);
});

test('un consultorio nunca tiene dos citas a la vez, aunque cambie el horario', async () => {
  await scheduleJuan();
  const ana = await registerPatient(h.base, 'Ana');
  const a = await ana.post(`${pub}/appointments`, { requestId: randomUUID(), doctorId, serviceId, startsAt: localIso(monday, '09:00') });
  assert.equal(a.status, 201);
  // Juan cambia su horario y libera el Consultorio 1; Ana entra al mismo consultorio el lunes.
  await owner.put(`/api/clinic/doctors/${doctorId}/schedule`, { rules: [{ weekday: 1, startMinute: 540, endMinute: 660, locationId: norte.id, roomId: room(norte, 'Consultorio 2') }] });
  assert.equal((await owner.put(`/api/clinic/doctors/${otherDoctorId}/schedule`, {
    rules: [{ weekday: 1, startMinute: 540, endMinute: 660, locationId: norte.id, roomId: room(norte, 'Consultorio 1') }],
  })).status, 200);
  // La cita existente de Juan sigue en el Consultorio 1: la Dra. Ana no tiene las 09:00 libres.
  assert.ok(!(await slots(monday, undefined, otherDoctorId)).some((s) => s.time === '09:00'));
  const p = await owner.post('/api/clinic/patients', { name: 'Don Pepe', phone: '33 1111 2222' });
  const staffTry = await owner.post('/api/clinic/appointments', {
    requestId: randomUUID(), doctorId: otherDoctorId, serviceId, clinicPatientId: p.body.id, startsAt: localIso(monday, '09:00'),
  });
  assert.equal(staffTry.status, 409);
  assert.match(staffTry.body.message, /consultorio «Consultorio 1» está ocupado/);
  // Y PostgreSQL lo impide aunque se salte la aplicación.
  const existing = await h.prisma.appointment.findUniqueOrThrow({ where: { id: a.body.appointment.id } });
  await assert.rejects(h.prisma.appointment.create({
    data: {
      clinicId: existing.clinicId, doctorId: otherDoctorId, serviceId, clinicPatientId: p.body.id,
      startsAt: existing.startsAt, endsAt: existing.endsAt, source: 'STAFF', serviceName: 'x', durationMinutes: 30,
      priceCents: 0, requestKey: randomUUID(), requestHash: 'a'.repeat(64), locationId: norte.id, roomId: existing.roomId,
    },
  }), /Appointment_room_no_double_booking|23P01|exclusion/i);
  assert.equal((await owner.post('/api/clinic/appointments', {
    requestId: randomUUID(), doctorId: otherDoctorId, serviceId, clinicPatientId: p.body.id, startsAt: localIso(monday, '09:30'),
  })).status, 201);
});

test('precios por sede y por médico: gana el más específico y se congela en la cita', async () => {
  await scheduleJuan();
  assert.equal((await owner.put(`/api/clinic/services/${serviceId}/prices`, { prices: [{ priceCents: 1 }] })).status, 400);
  assert.equal((await owner.put(`/api/clinic/services/${serviceId}/prices`, {
    prices: [{ locationId: sur.id, priceCents: 1 }, { locationId: sur.id, priceCents: 2 }],
  })).status, 400);
  const saved = await owner.put(`/api/clinic/services/${serviceId}/prices`, {
    prices: [
      { locationId: sur.id, priceCents: 70000 },
      { doctorId: otherDoctorId, priceCents: 80000 },
      { doctorId, locationId: sur.id, priceCents: 90000 },
    ],
  });
  assert.equal(saved.status, 200);
  const profile = (await new Client(h.base).get(pub)).body;
  const juanSvc = profile.doctors.find((d: { id: string }) => d.id === doctorId).services[0];
  assert.deepEqual(juanSvc.priceByLocation, { [norte.id]: 60000, [sur.id]: 90000 });

  const ana = await registerPatient(h.base, 'Ana');
  const n = await ana.post(`${pub}/appointments`, { requestId: randomUUID(), doctorId, serviceId, startsAt: localIso(monday, '09:00') });
  const s = await ana.post(`${pub}/appointments`, { requestId: randomUUID(), doctorId, serviceId, startsAt: localIso(wednesday, '16:00') });
  assert.equal(n.body.appointment.priceCents, 60000);
  assert.equal(s.body.appointment.priceCents, 90000);
  // Cambiar el precio después no altera citas ya agendadas.
  await owner.put(`/api/clinic/services/${serviceId}/prices`, { prices: [] });
  assert.equal((await h.prisma.appointment.findUniqueOrThrow({ where: { id: s.body.appointment.id } })).priceCents, 90000);
});

test('servicios sólo de primera vez o subsecuentes', async () => {
  await scheduleJuan();
  const first = (await owner.post('/api/clinic/services', { name: 'Primera vez', durationMinutes: 30, priceCents: 0, visitType: 'FIRST' })).body;
  const follow = (await owner.post('/api/clinic/services', { name: 'Subsecuente', durationMinutes: 30, priceCents: 0, visitType: 'FOLLOW_UP' })).body;
  await owner.patch(`/api/clinic/doctors/${doctorId}`, { serviceIds: [serviceId, first.id, follow.id] });
  const ana = await registerPatient(h.base, 'Ana');
  const book = (svc: string, time: string) =>
    ana.post(`${pub}/appointments`, { requestId: randomUUID(), doctorId, serviceId: svc, startsAt: localIso(monday, time) });
  const noHistory = await book(follow.id, '09:00');
  assert.equal(noHistory.status, 409);
  assert.match(noHistory.body.message, /ya fueron atendidos/);
  const ok = await book(first.id, '09:00');
  assert.equal(ok.status, 201);
  await h.prisma.appointment.update({
    where: { id: ok.body.appointment.id },
    data: { status: 'COMPLETED', startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() - 86_400_000 + 1_800_000) },
  });
  assert.equal((await book(first.id, '10:00')).status, 409);
  assert.equal((await book(follow.id, '10:00')).status, 201);
  const profile = (await new Client(h.base).get(pub)).body;
  const juan = profile.doctors.find((d: { id: string }) => d.id === doctorId);
  assert.equal(juan.services.find((x: { id: string }) => x.id === first.id).visitType, 'FIRST');
});

test('perfil profesional y foto', async () => {
  const upd = await owner.patch(`/api/clinic/doctors/${doctorId}`, {
    education: [' Médico Cirujano, UNAM ', 'Especialidad en Cardiología, IMSS', 'Médico Cirujano, UNAM'],
    certifications: ['Consejo Mexicano de Cardiología'], languages: ['Español', 'Inglés'],
    conditions: ['Hipertensión', 'Arritmias'], insurers: ['GNP', 'AXA'],
  });
  assert.equal(upd.status, 200);
  assert.deepEqual(upd.body.education, ['Médico Cirujano, UNAM', 'Especialidad en Cardiología, IMSS']);
  assert.equal((await owner.patch(`/api/clinic/doctors/${doctorId}`, { languages: ['x'.repeat(121)] })).status, 400);

  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  const upload = async (bytes: Buffer, type: string, client = owner, doc = doctorId) => {
    const form = new FormData();
    form.append('photo', new Blob([new Uint8Array(bytes)], { type }), 'foto');
    const res = await fetch(`${h.base}/api/clinic/doctors/${doc}/photo`, {
      method: 'POST', body: form, headers: { origin: ORIGIN, authorization: `Bearer ${client.token}` },
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as { photoUrl: string } };
  };
  assert.equal((await upload(Buffer.from('no soy una imagen'), 'image/png')).status, 400);
  assert.equal((await upload(Buffer.alloc(950 * 1024, 1), 'image/png')).status, 413);
  const ok = await upload(png, 'image/png');
  assert.equal(ok.status, 201);
  assert.match(ok.body.photoUrl, new RegExp(`^/api/public/doctors/${doctorId}/photo\\?v=\\d+$`));
  const img = await fetch(`${h.base}${ok.body.photoUrl}`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.match(img.headers.get('cache-control')!, /immutable/);
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), png);

  await scheduleJuan();
  const juan = (await new Client(h.base).get(pub)).body.doctors.find((d: { id: string }) => d.id === doctorId);
  assert.equal(juan.photoUrl, ok.body.photoUrl);
  assert.deepEqual(juan.insurers, ['GNP', 'AXA']);
  assert.equal((await owner.del(`/api/clinic/doctors/${doctorId}/photo`)).status, 204);
  assert.equal((await fetch(`${h.base}${ok.body.photoUrl}`)).status, 404);
});
