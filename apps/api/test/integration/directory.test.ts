import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import {
  Client, Harness, TZ, createClinicWithOwner, localIso, loginStaff, nextMonday, randomUUID, registerPatient, resetDb,
  startHarness,
} from './harness';
import { DirectoryService } from '../../src/directory/directory.service';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const SLUG = 'clinica-norte';
let owner: Client;
let serviceId: string;
let locationId: string;
const anon = () => new Client(h.base);
const search = async (qs: string) => {
  h.app.get(DirectoryService).clearCache();
  const r = await anon().get(`/api/public/directory/search?${qs}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const names = (body: { results: { doctor: { displayName: string } }[] }) => body.results.map((r) => r.doctor.displayName);
/** Todos los días, todo el día: siempre hay horario mañana. */
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 }));

beforeEach(async () => {
  await resetDb(h.prisma);
  const created = await createClinicWithOwner(h.prisma, SLUG);
  owner = await loginStaff(h.base, created.email, created.password, SLUG);
  serviceId = (await owner.post('/api/clinic/services', { name: 'Consulta', durationMinutes: 30, priceCents: 80000 })).body.id;
  locationId = (await owner.get('/api/clinic/locations')).body[0].id;
  await owner.patch(`/api/clinic/locations/${locationId}`, {
    city: 'Benito Juárez', neighborhood: 'Del Valle', latitude: 19.3867, longitude: -99.1656,
  });
  await owner.patch('/api/clinic', { directoryEnabled: true });
});

async function doctor(displayName: string, extra: Record<string, unknown> = {}, rules: object[] = ALL_WEEK) {
  const r = await owner.post('/api/clinic/doctors', { displayName, specialty: 'Cardiología', serviceIds: [serviceId], ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (rules.length) {
    const s = await owner.put(`/api/clinic/doctors/${r.body.id}/schedule`, { rules });
    assert.equal(s.status, 200, JSON.stringify(s.body));
  }
  return r.body.id as string;
}

test('sólo aparecen clínicas participantes y médicos con agenda en línea', async () => {
  await doctor('Dra. Ana López');
  await doctor('Dr. Sin Horario', {}, []);
  const inactive = await doctor('Dr. Inactivo');
  await owner.patch(`/api/clinic/doctors/${inactive}`, { active: false });
  assert.deepEqual(names(await search('')), ['Dra. Ana López']);

  await owner.patch('/api/clinic', { directoryEnabled: false });
  assert.equal((await search('')).total, 0);
  await owner.patch('/api/clinic', { directoryEnabled: true, bookingEnabled: false });
  assert.equal((await search('')).total, 0);
  await owner.patch('/api/clinic', { bookingEnabled: true });

  const overview = (await anon().get('/api/public/directory')).body;
  assert.deepEqual(overview.specialties, [{ slug: 'cardiologia', name: 'Cardiología', doctors: 1 }]);
  assert.deepEqual(overview.cities, [{ slug: 'benito-juarez', name: 'Benito Juárez', doctors: 1 }]);
  assert.deepEqual(overview.combos.map((c: { specialty: string; city: string }) => [c.specialty, c.city]), [['cardiologia', 'benito-juarez']]);
});

test('catálogo: la base deduce especialidad y padecimientos del texto, y la búsqueda los entiende', async () => {
  const ana = await doctor('Dra. Ana López', { specialty: 'cardiólogo', conditions: ['Presión alta', 'Arritmias raras'] });
  const luis = await doctor('Dr. Luis Pérez', { specialty: 'Endocrinología' });
  await doctor('Dra. Marta Ruiz', { specialty: 'Medicina estética avanzada' });

  const listed = (await owner.get('/api/clinic/doctors')).body as { displayName: string; inCatalog: boolean }[];
  // Sin depender del orden alfabético, que cambia con la intercalación (locale) de la base.
  assert.deepEqual(Object.fromEntries(listed.map((d) => [d.displayName, d.inCatalog])), {
    'Dr. Luis Pérez': true, 'Dra. Ana López': true, 'Dra. Marta Ruiz': false,
  });
  const conds = await h.prisma.doctorCondition.findMany({ where: { doctorId: ana }, include: { condition: true } });
  assert.deepEqual(conds.map((c) => c.condition.slug), ['hipertension']);

  // Sinónimo de especialidad → filtro de especialidad.
  const cardio = await search('q=Cardiologo');
  assert.deepEqual(cardio.resolved.specialty, { slug: 'cardiologia', name: 'Cardiología' });
  assert.deepEqual(names(cardio), ['Dra. Ana López']);
  // Padecimiento: quien lo declara va primero; también aparecen las especialidades que lo tratan.
  const presion = await search('q=presi%C3%B3n%20alta');
  assert.equal(presion.resolved.condition.slug, 'hipertension');
  assert.equal(names(presion)[0], 'Dra. Ana López');
  const diabetes = await search('padecimiento=diabetes');
  assert.deepEqual(names(diabetes), ['Dr. Luis Pérez']);
  // Editar los padecimientos reindexa.
  await owner.patch(`/api/clinic/doctors/${luis}`, { conditions: ['Hipertensión'] });
  assert.deepEqual((await h.prisma.doctorCondition.findMany({ where: { doctorId: luis }, include: { condition: true } })).map((c) => c.condition.slug), ['hipertension']);
  // Texto libre con error de dedo y nombre de la clínica.
  assert.deepEqual(names(await search('q=ana%20lopz')), ['Dra. Ana López']);
  assert.equal((await search('q=norte%20estetica')).results[0].doctor.displayName, 'Dra. Marta Ruiz');
  assert.equal((await search('especialidad=no-existe')).total, 0);

  const sug = (await anon().get('/api/public/directory/suggest?q=pedi')).body;
  assert.deepEqual(sug.specialties.map((s: { slug: string }) => s.slug), ['pediatria']);
});

test('filtros: ciudad, colonia, aseguradora, videoconsulta, precio y distancia', async () => {
  const ana = await doctor('Dra. Ana López', { insurers: ['GNP Seguros'] });
  const second = (await owner.post('/api/clinic/locations', {
    name: 'Sede Guadalajara', city: 'Guadalajara', mapUrl: 'https://www.google.com/maps/place/X/@20.6736,-103.344,17z',
  })).body;
  assert.deepEqual([second.latitude, second.longitude], [20.6736, -103.344]);
  await owner.put(`/api/clinic/locations/${second.id}/hours`, { hours: ALL_WEEK });
  const tele = (await owner.post('/api/clinic/services', { name: 'Videoconsulta', durationMinutes: 20, priceCents: 50000, telemedicine: true })).body.id;
  const luis = await doctor('Dr. Luis Pérez', { serviceIds: [serviceId, tele] }, ALL_WEEK.map((r) => ({ ...r, locationId: second.id })));
  // Precio especial más bajo sólo para Ana.
  await owner.put(`/api/clinic/services/${serviceId}/prices`, { prices: [{ doctorId: ana, locationId: null, priceCents: 45000 }] });

  assert.deepEqual(names(await search('ciudad=benito-juarez')), ['Dra. Ana López']);
  assert.deepEqual(names(await search('ciudad=guadalajara')), ['Dr. Luis Pérez']);
  assert.deepEqual(names(await search('colonia=del-valle')), ['Dra. Ana López']);
  assert.deepEqual(names(await search('aseguradora=gnp')), ['Dra. Ana López']);
  assert.deepEqual(names(await search('videoconsulta=true')), ['Dr. Luis Pérez']);
  const cheap = await search('precioMax=46000');
  assert.deepEqual(names(cheap), ['Dra. Ana López']);
  assert.equal(cheap.results[0].priceFromCents, 45000);
  assert.deepEqual(names(await search('orden=precio')), ['Dra. Ana López', 'Dr. Luis Pérez']);
  // El servicio para «próxima cita» de Luis es el más económico (videoconsulta).
  const luisRow = (await search('ciudad=guadalajara')).results[0];
  assert.equal(luisRow.service.id, tele);
  assert.equal(luisRow.telemedicine, true);

  const near = await search('lat=19.39&lng=-99.17&radioKm=5&orden=distancia');
  assert.deepEqual(names(near), ['Dra. Ana López']);
  assert.ok(near.results[0].distanceKm < 1);
  assert.deepEqual(names(await search('lat=20.67&lng=-103.35&radioKm=50&orden=distancia')), ['Dr. Luis Pérez']);
  assert.equal((await anon().get('/api/public/directory/search?lat=95&lng=0')).status, 400);
  assert.equal((await owner.patch(`/api/clinic/locations/${locationId}`, { latitude: 19 })).status, 400);
  void luis;
});

test('próxima disponibilidad, filtro «cuándo» y reserva directa desde el directorio', async () => {
  const soon = await doctor('Dra. Pronto');
  // Sólo atiende los lunes, y está de vacaciones hasta el lunes de dentro de una o dos semanas.
  const monday = nextMonday();
  const late = await doctor('Dr. Tarde', {}, [{ weekday: 1, startMinute: 540, endMinute: 600 }]);
  const clinic = await h.prisma.clinic.findUniqueOrThrow({ where: { slug: SLUG } });
  const user = await h.prisma.user.findFirstOrThrow();
  await h.prisma.timeOff.create({
    data: {
      doctorId: late, clinicId: clinic.id, startsAt: new Date(), reason: 'Vacaciones', createdById: user.id,
      endsAt: DateTime.fromISO(monday, { zone: TZ }).toJSDate(),
    },
  });

  const all = await search('orden=disponibilidad');
  assert.deepEqual(names(all), ['Dra. Pronto', 'Dr. Tarde']);
  const lateRow = all.results[1];
  assert.equal(lateRow.doctor.id, late);
  assert.equal(lateRow.next.date, monday);
  assert.deepEqual(lateRow.next.slots.map((s: { time: string }) => s.time), ['09:00', '09:30']);
  assert.equal(lateRow.next.slots[0].startsAt, localIso(monday, '09:00'));
  assert.equal(lateRow.next.slots[0].locationId, locationId);
  assert.deepEqual(names(await search('cuando=semana')), ['Dra. Pronto']);

  // Reservar el primer horario de «Dr. Tarde» con canal directorio: el directorio deja de ofrecerlo.
  const ana = await registerPatient(h.base, 'Ana');
  const booked = await ana.post(`/api/public/clinics/${SLUG}/appointments`, {
    requestId: randomUUID(), doctorId: late, serviceId: lateRow.service.id, startsAt: lateRow.next.slots[0].startsAt, channel: 'directorio',
  });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  assert.equal(booked.body.appointment.channel, 'directorio');
  const later = (await search('orden=disponibilidad')).results.find((r: { doctor: { id: string } }) => r.doctor.id === late);
  assert.deepEqual(later.next.slots.map((s: { time: string }) => s.time), ['09:30']);

  // La primera de «Dra. Pronto» es hoy o mañana, en hora local de la clínica.
  const first = (await search('cuando=manana')).results[0];
  assert.equal(first.doctor.id, soon);
  const today = DateTime.now().setZone(TZ).toISODate()!;
  assert.ok([today, DateTime.now().setZone(TZ).plus({ days: 1 }).toISODate()].includes(first.next.date));
});
