import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Client, Harness, createClinicWithOwner, localIso, loginStaff, nextMonday, randomUUID, registerPatient, resetDb,
  startHarness,
} from './harness';
import { slugify } from '../../src/common/slug';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const SLUG = 'clinica-a';
let owner: Client;
let serviceId: string;

beforeEach(async () => {
  await resetDb(h.prisma);
  const created = await createClinicWithOwner(h.prisma, SLUG);
  owner = await loginStaff(h.base, created.email, created.password, SLUG);
  serviceId = (await owner.post('/api/clinic/services', { name: 'Consulta', durationMinutes: 30, priceCents: 60000 })).body.id;
});

const newDoctor = (displayName: string, extra: object = {}) =>
  owner.post('/api/clinic/doctors', { displayName, specialty: 'Cardiología', serviceIds: [serviceId], ...extra });

test('slugify: sin título, acentos ni signos', () => {
  assert.equal(slugify('Dra. Ana María Núñez'), 'ana-maria-nunez');
  assert.equal(slugify('Dr José   Pérez-Gómez (Cardiología)'), 'jose-perez-gomez-cardiologia');
  assert.equal(slugify('Doctora Lucía'), 'lucia');
  assert.equal(slugify('¡¿?!'), 'medico');
});

test('URL pública de cada médico: generada, única por clínica y editable', async () => {
  const a = await newDoctor('Dr. José Núñez');
  const b = await newDoctor('Dr. José Núñez');
  assert.equal(a.body.slug, 'jose-nunez');
  assert.equal(b.body.slug, 'jose-nunez-2');
  assert.equal((await newDoctor('Dra. Ana', { slug: 'jose-nunez' })).status, 409);
  assert.equal((await owner.patch(`/api/clinic/doctors/${b.body.id}`, { slug: 'Con Espacios' })).status, 400);
  assert.equal((await owner.patch(`/api/clinic/doctors/${b.body.id}`, { slug: 'jose-nunez' })).status, 409);
  const renamed = await owner.patch(`/api/clinic/doctors/${b.body.id}`, { slug: 'jose-nunez-pediatra', displayName: 'Dr. José Núñez Ruiz' });
  assert.equal(renamed.status, 200);
  // Cambiar el nombre no cambia la URL.
  assert.equal((await owner.patch(`/api/clinic/doctors/${a.body.id}`, { displayName: 'Dr. José A. Núñez' })).body.slug, 'jose-nunez');
  // Otra clínica puede usar el mismo slug.
  const other = await createClinicWithOwner(h.prisma, 'clinica-b');
  const ownerB = await loginStaff(h.base, other.email, other.password, 'clinica-b');
  const svcB = (await ownerB.post('/api/clinic/services', { name: 'Consulta', durationMinutes: 30, priceCents: 0 })).body.id;
  assert.equal((await ownerB.post('/api/clinic/doctors', { displayName: 'Dr. José Núñez', specialty: 'Cardiología', serviceIds: [svcB] })).body.slug, 'jose-nunez');

  const profile = (await new Client(h.base).get(`/api/public/clinics/${SLUG}`)).body;
  assert.deepEqual(profile.doctors.map((d: { slug: string }) => d.slug).sort(), ['jose-nunez', 'jose-nunez-pediatra']);
});

test('mapa del sitio: clínicas activas y médicos con servicios', async () => {
  await newDoctor('Dra. Ana López');
  await owner.post('/api/clinic/doctors', { displayName: 'Dr. Sin Servicios', specialty: 'Pediatría', serviceIds: [] });
  const inactive = await newDoctor('Dr. Inactivo');
  await owner.patch(`/api/clinic/doctors/${inactive.body.id}`, { active: false });
  const off = await createClinicWithOwner(h.prisma, 'clinica-cerrada');
  await h.prisma.clinic.update({ where: { slug: off.clinic.slug }, data: { active: false } });
  const map = (await new Client(h.base).get('/api/public/sitemap')).body;
  assert.deepEqual(map.map((c: { slug: string }) => c.slug), [SLUG]);
  assert.deepEqual(map[0].doctors.map((d: { slug: string }) => d.slug), ['ana-lopez']);
  assert.ok(map[0].updatedAt);
});

test('canal de la reserva en línea: web por omisión, Google, Instagram o widget', async () => {
  const doctorId = (await newDoctor('Dr. Juan')).body.id;
  await owner.put(`/api/clinic/doctors/${doctorId}/schedule`, { rules: [{ weekday: 1, startMinute: 540, endMinute: 660 }] });
  const monday = nextMonday();
  const ana = await registerPatient(h.base, 'Ana');
  const book = (time: string, extra: object = {}) => ana.post(`/api/public/clinics/${SLUG}/appointments`, {
    requestId: randomUUID(), doctorId, serviceId, startsAt: localIso(monday, time), ...extra,
  });
  assert.equal((await book('09:00', { channel: 'tiktok' })).status, 400);
  assert.equal((await book('09:00')).body.appointment.channel, 'web');
  assert.equal((await book('09:30', { channel: 'google' })).body.appointment.channel, 'google');
  assert.equal((await book('10:00', { channel: 'widget' })).body.appointment.channel, 'widget');
  const agenda = (await owner.get(`/api/clinic/appointments?from=${monday}&days=1`)).body.appointments;
  assert.deepEqual(agenda.map((a: { channel: string }) => a.channel), ['web', 'google', 'widget']);
});
