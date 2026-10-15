import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Client, Harness, createClinicWithOwner, localIso, loginStaff, nextMonday, randomUUID, registerPatient, resetDb,
  startHarness,
} from './harness';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

let owner: Client;
let doctorId: string;
let serviceId: string;
let monday: string;
const SLUG = 'clinica-a';
const pub = `/api/public/clinics/${SLUG}`;

beforeEach(async () => {
  await resetDb(h.prisma);
  const { email, password } = await createClinicWithOwner(h.prisma, SLUG);
  owner = await loginStaff(h.base, email, password, SLUG);
  const service = await owner.post('/api/clinic/services', { name: 'Consulta', durationMinutes: 30, priceCents: 60000 });
  assert.equal(service.status, 201);
  serviceId = service.body.id;
  const doctor = await owner.post('/api/clinic/doctors', {
    displayName: 'Dr. Juan López', specialty: 'Cardiología', serviceIds: [serviceId],
  });
  assert.equal(doctor.status, 201);
  doctorId = doctor.body.id;
  const sched = await owner.put(`/api/clinic/doctors/${doctorId}/schedule`, {
    rules: [{ weekday: 1, startMinute: 540, endMinute: 660 }, { weekday: 3, startMinute: 960, endMinute: 1020 }],
  });
  assert.equal(sched.status, 200);
  monday = nextMonday();
});

async function slots(c: Client, date = monday) {
  const r = await c.get(`${pub}/doctors/${doctorId}/availability?serviceId=${serviceId}&from=${date}&days=1`);
  assert.equal(r.status, 200);
  return r.body.days[0].slots.map((s: { time: string }) => s.time) as string[];
}

function book(c: Client, time: string, requestId = randomUUID(), extra: object = {}) {
  return c.post(`${pub}/appointments`, {
    requestId, doctorId, serviceId, startsAt: localIso(monday, time), ...extra,
  });
}

test('perfil público y horarios disponibles', async () => {
  const profile = await new Client(h.base).get(pub);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.doctors[0].displayName, 'Dr. Juan López');
  assert.equal(profile.body.doctors[0].services[0].priceCents, 60000);
  assert.deepEqual(await slots(new Client(h.base)), ['09:00', '09:30', '10:00', '10:30']);
  assert.equal((await new Client(h.base).get('/api/public/clinics/no-existe')).status, 404);
});

test('reserva, reintento idempotente y horario ocupado', async () => {
  const ana = await registerPatient(h.base, 'Ana');
  const requestId = randomUUID();
  const first = await book(ana, '09:30', requestId, { notes: 'Dolor de pecho' });
  assert.equal(first.status, 201);
  assert.equal(first.body.replayed, false);
  assert.equal(first.body.appointment.priceCents, 60000);
  const replay = await book(ana, '09:30', requestId, { notes: 'Dolor de pecho' });
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.appointment.id, first.body.appointment.id);
  assert.equal((await book(ana, '10:00', requestId)).status, 409);
  assert.deepEqual(await slots(ana), ['09:00', '10:00', '10:30']);

  const beto = await registerPatient(h.base, 'Beto');
  assert.equal((await book(beto, '09:30')).status, 409);
  // Hora fuera de la cuadrícula publicada.
  assert.equal((await book(beto, '09:15')).status, 409);
  // Sin sesión de paciente.
  assert.equal((await book(new Client(h.base), '10:00')).status, 401);

  const list = await ana.get('/api/patient/appointments');
  assert.equal(list.body.upcoming.length, 1);
  assert.equal(list.body.upcoming[0].canChangeOnline, true);
  assert.equal((await beto.get('/api/patient/appointments')).body.upcoming.length, 0);
});

test('reservas simultáneas del mismo horario: sólo una gana', async () => {
  const patients = await Promise.all(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((n) => registerPatient(h.base, n)));
  const results = await Promise.all(patients.map((p) => book(p, '10:00')));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409, 409, 409]);
  assert.equal(await h.prisma.appointment.count({ where: { status: 'BOOKED' } }), 1);
});

test('PostgreSQL impide el doble agendado aunque se salte la aplicación', async () => {
  const ana = await registerPatient(h.base, 'Ana');
  const a = (await book(ana, '09:00')).body.appointment;
  await assert.rejects(
    h.prisma.appointment.create({
      data: {
        clinicId: a.clinicId, doctorId, serviceId, clinicPatientId: a.clinicPatientId,
        startsAt: new Date(new Date(a.startsAt).getTime() + 10 * 60_000),
        endsAt: new Date(new Date(a.startsAt).getTime() + 40 * 60_000),
        source: 'STAFF', serviceName: 'x', durationMinutes: 30, priceCents: 0,
        requestKey: randomUUID(), requestHash: 'a'.repeat(64),
      },
    }),
    /Appointment_no_double_booking|23P01|exclusion/i,
  );
});

test('límite de citas próximas por paciente', async () => {
  const ana = await registerPatient(h.base, 'Ana');
  for (const t of ['09:00', '09:30', '10:00']) assert.equal((await book(ana, t)).status, 201);
  assert.equal((await book(ana, '10:30')).status, 409);
});

test('cancelación y reprogramación por el paciente', async () => {
  const ana = await registerPatient(h.base, 'Ana');
  const a = (await book(ana, '09:00')).body.appointment;
  const avail = await ana.get(`/api/patient/appointments/${a.id}/availability/${monday}`);
  // Incluye su propio horario porque se excluye la cita al reprogramar.
  assert.deepEqual(avail.body.days[0].slots.map((s: { time: string }) => s.time), ['09:00', '09:30', '10:00', '10:30']);

  const moved = await ana.post(`/api/patient/appointments/${a.id}/reschedule`, {
    startsAt: localIso(monday, '09:30'), expectedStartsAt: a.startsAt,
  });
  assert.equal(moved.status, 200);
  assert.equal(new Date(moved.body.startsAt).toISOString(), localIso(monday, '09:30'));
  // Reintento idéntico: sin cambios. Expectativa obsoleta hacia otro horario: conflicto.
  assert.equal((await ana.post(`/api/patient/appointments/${a.id}/reschedule`, {
    startsAt: localIso(monday, '09:30'), expectedStartsAt: a.startsAt,
  })).status, 200);
  assert.equal((await ana.post(`/api/patient/appointments/${a.id}/reschedule`, {
    startsAt: localIso(monday, '10:30'), expectedStartsAt: a.startsAt,
  })).status, 409);

  const beto = await registerPatient(h.base, 'Beto');
  assert.equal((await beto.post(`/api/patient/appointments/${a.id}/cancel`, {})).status, 404);
  const cancelled = await ana.post(`/api/patient/appointments/${a.id}/cancel`, {});
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'CANCELLED');
  assert.equal((await ana.post(`/api/patient/appointments/${a.id}/cancel`, {})).status, 200);
  assert.deepEqual(await slots(ana), ['09:00', '09:30', '10:00', '10:30']);
  const events = await h.prisma.appointmentEvent.findMany({ where: { appointmentId: a.id }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(events.map((e) => e.type), ['CREATED', 'RESCHEDULED', 'CANCELLED']);
});

test('no se cancela en línea dentro del plazo mínimo de la clínica', async () => {
  const ana = await registerPatient(h.base, 'Ana');
  const a = (await book(ana, '09:00')).body.appointment;
  // Se acerca la cita a 60 minutos; la clínica exige 120 para cambios en línea.
  const soon = new Date(Math.ceil((Date.now() + 60 * 60_000) / 60_000) * 60_000);
  await h.prisma.appointment.update({
    where: { id: a.id }, data: { startsAt: soon, endsAt: new Date(soon.getTime() + 30 * 60_000) },
  });
  assert.equal((await ana.post(`/api/patient/appointments/${a.id}/cancel`, {})).status, 409);
  assert.equal((await ana.get('/api/patient/appointments')).body.upcoming[0].canChangeOnline, false);
  // El personal sí puede cancelar con motivo.
  assert.equal((await owner.post(`/api/clinic/appointments/${a.id}/cancel`, { reason: 'Paciente llamó' })).status, 200);
});

test('bloqueos de agenda', async () => {
  const ana = await registerPatient(h.base, 'Ana');
  await book(ana, '09:00');
  const conflict = await owner.post(`/api/clinic/doctors/${doctorId}/time-off`, {
    startsAt: localIso(monday, '08:00'), endsAt: localIso(monday, '09:30'), reason: 'Congreso',
  });
  assert.equal(conflict.status, 409);
  const ok = await owner.post(`/api/clinic/doctors/${doctorId}/time-off`, {
    startsAt: localIso(monday, '09:30'), endsAt: localIso(monday, '10:30'), reason: 'Junta',
  });
  assert.equal(ok.status, 201);
  assert.deepEqual(await slots(ana), ['10:30']);
  assert.equal((await book(ana, '10:00')).status, 409);
  assert.equal((await owner.del(`/api/clinic/doctors/${doctorId}/time-off/${ok.body.id}`)).status, 204);
  assert.deepEqual(await slots(ana), ['09:30', '10:00', '10:30']);
});

test('recepción agenda a un paciente telefónico y el médico ve sólo su agenda', async () => {
  await owner.post('/api/clinic/members', { name: 'Rec', email: 'rec@test.mx', password: 'recepcionista-1', role: 'RECEPTION' });
  const docMember = await owner.post('/api/clinic/members', { name: 'Dr Juan', email: 'juan@test.mx', password: 'medico-seguro-01', role: 'DOCTOR' });
  assert.equal((await owner.patch(`/api/clinic/doctors/${doctorId}`, { membershipId: docMember.body.id })).status, 200);
  const other = await owner.post('/api/clinic/doctors', { displayName: 'Dra. Otra', specialty: 'Pediatría', serviceIds: [serviceId] });
  await owner.put(`/api/clinic/doctors/${other.body.id}/schedule`, { rules: [{ weekday: 1, startMinute: 540, endMinute: 600 }] });

  const rec = await loginStaff(h.base, 'rec@test.mx', 'recepcionista-1', SLUG);
  const patient = await rec.post('/api/clinic/patients', { name: 'Don Pepe', phone: '33 1111 2222' });
  assert.equal(patient.status, 201);
  const base = { doctorId, serviceId, clinicPatientId: patient.body.id };
  assert.equal((await rec.post('/api/clinic/appointments', { ...base, requestId: randomUUID(), startsAt: localIso(monday, '12:00') })).status, 409);
  // El personal puede agendar fuera de la cuadrícula si cabe en el horario.
  const a = await rec.post('/api/clinic/appointments', { ...base, requestId: randomUUID(), startsAt: localIso(monday, '09:10') });
  assert.equal(a.status, 201);
  assert.equal(a.body.source, 'STAFF');
  const patient2 = await rec.post('/api/clinic/patients', { name: 'Doña Luz', phone: '33 3333 4444' });
  assert.equal((await rec.post('/api/clinic/appointments', {
    doctorId: other.body.id, serviceId, clinicPatientId: patient2.body.id, requestId: randomUUID(), startsAt: localIso(monday, '09:00'),
  })).status, 201);
  // El mismo paciente no puede tener dos citas simultáneas con distintos médicos.
  assert.equal((await rec.post('/api/clinic/appointments', {
    doctorId: other.body.id, serviceId, clinicPatientId: patient.body.id, requestId: randomUUID(), startsAt: localIso(monday, '09:30'),
  })).status, 409);
  const search = await rec.get('/api/clinic/patients?q=luz');
  assert.deepEqual(search.body.map((p: { name: string }) => p.name), ['Doña Luz']);

  assert.equal((await rec.get(`/api/clinic/appointments?from=${monday}`)).body.appointments.length, 2);
  const doc = await loginStaff(h.base, 'juan@test.mx', 'medico-seguro-01', SLUG);
  const mine = await doc.get(`/api/clinic/appointments?from=${monday}`);
  assert.equal(mine.body.appointments.length, 1);
  assert.equal(mine.body.appointments[0].patient.name, 'Don Pepe');
  assert.equal((await doc.get(`/api/clinic/appointments?from=${monday}&doctorId=${other.body.id}`)).status, 403);
  assert.equal((await doc.put(`/api/clinic/doctors/${other.body.id}/schedule`, { rules: [] })).status, 403);
  assert.equal((await doc.post(`/api/clinic/appointments`, { ...base, requestId: randomUUID(), startsAt: localIso(monday, '10:00') })).status, 403);
  // Registrar asistencia antes de la cita no está permitido.
  assert.equal((await doc.post(`/api/clinic/appointments/${a.body.id}/outcome`, { status: 'COMPLETED', expectedStatus: 'BOOKED' })).status, 409);
  // Reprogramación por recepción al miércoles.
  const wednesday = new Date(new Date(localIso(monday, '16:00')).getTime() + 2 * 86400_000).toISOString();
  const moved = await rec.post(`/api/clinic/appointments/${a.body.id}/reschedule`, { startsAt: wednesday, expectedStartsAt: a.body.startsAt });
  assert.equal(moved.status, 200);
});

test('aislamiento entre clínicas', async () => {
  const ana = await registerPatient(h.base, 'Ana');
  const a = (await book(ana, '09:00')).body.appointment;
  const other = await createClinicWithOwner(h.prisma, 'clinica-b');
  const b = await loginStaff(h.base, other.email, other.password, 'clinica-b');
  assert.equal((await b.get(`/api/clinic/appointments/${a.id}`)).status, 404);
  assert.equal((await b.post(`/api/clinic/appointments/${a.id}/cancel`, { reason: 'x'.repeat(5) })).status, 404);
  assert.equal((await b.get(`/api/clinic/appointments?from=${monday}`)).body.appointments.length, 0);
  assert.equal((await b.put(`/api/clinic/doctors/${doctorId}/schedule`, { rules: [] })).status, 404);
  assert.equal((await b.post('/api/clinic/doctors', { displayName: 'X Y', specialty: 'Z Z', serviceIds: [serviceId] })).status, 404);
  assert.equal((await b.get(`/api/clinic/doctors/${doctorId}/availability?serviceId=${serviceId}&from=${monday}`)).status, 404);
});

test('reservas en línea desactivadas', async () => {
  assert.equal((await owner.patch('/api/clinic', { bookingEnabled: false })).status, 200);
  const ana = await registerPatient(h.base, 'Ana');
  const r = await ana.get(`${pub}/doctors/${doctorId}/availability?serviceId=${serviceId}&from=${monday}`);
  assert.equal(r.body.bookingEnabled, false);
  assert.equal((await book(ana, '09:00')).status, 403);
});
