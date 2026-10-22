import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import {
  Client, Harness, ORIGIN, TZ, addStaff, createClinicWithOwner, linkToken, localIso, loginStaff, nextMonday, randomUUID,
  registerPatient, resetDb, startHarness,
} from './harness';
import { VideoService } from '../../src/video/video.service';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const SLUG = 'clinica-video';
let owner: Client;
let videoService: string;
let inPerson: string;
let doctorId: string;
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 }));

beforeEach(async () => {
  await resetDb(h.prisma);
  h.video.rooms.clear();
  h.video.tokens = [];
  const created = await createClinicWithOwner(h.prisma, SLUG);
  owner = await loginStaff(h.base, created.email, created.password, SLUG);
  videoService = (await owner.post('/api/clinic/services', { name: 'Consulta', durationMinutes: 30, priceCents: 60000, telemedicine: true })).body.id;
  inPerson = (await owner.post('/api/clinic/services', { name: 'Ultrasonido', durationMinutes: 30, priceCents: 90000 })).body.id;
  doctorId = (await owner.post('/api/clinic/doctors', { displayName: 'Dra. Ana', specialty: 'Cardiología', serviceIds: [videoService, inPerson] })).body.id;
  await owner.put(`/api/clinic/doctors/${doctorId}/schedule`, { rules: ALL_WEEK });
});

async function book(patient: Client, serviceId: string, startsAt: string, modality?: string) {
  return patient.post(`/api/public/clinics/${SLUG}/appointments`, { requestId: randomUUID(), doctorId, serviceId, startsAt, modality });
}

/** Lleva la cita a «ahora + minutos» (directo en la base) para probar la ventana de la sala. */
async function moveTo(id: string, minutesFromNow: number) {
  const startsAt = new Date(Math.round((Date.now() + minutesFromNow * 60_000) / 60_000) * 60_000);
  await h.prisma.appointment.update({ where: { id }, data: { startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000) } });
}

const linkPost = (path: string, body: object) => fetch(`${h.base}/api/video/link/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));

test('videoconsulta: sólo en servicios que la ofrecen; el correo trae el enlace a la sala', async () => {
  const ana = await registerPatient(h.base, 'Ana');
  await h.deliver();
  const monday = nextMonday();
  const profile = (await new Client(h.base).get(`/api/public/clinics/${SLUG}`)).body;
  assert.deepEqual(profile.doctors[0].services.map((s: { name: string; telemedicine: boolean }) => [s.name, s.telemedicine]), [['Consulta', true], ['Ultrasonido', false]]);

  assert.equal((await book(ana, inPerson, localIso(monday, '09:00'), 'VIDEO')).status, 400);
  const r = await book(ana, videoService, localIso(monday, '09:00'), 'VIDEO');
  assert.equal(r.status, 201);
  assert.equal(r.body.appointment.modality, 'VIDEO');
  const mail = (await h.deliver()).find((e) => /Cita confirmada/.test(e.subject))!;
  assert.match(mail.text, /Videoconsulta/);
  assert.match(mail.text, /Entrar a la videoconsulta: http:\/\/localhost:6011\/consulta#/);
  assert.doesNotMatch(mail.text, /Dirección:/);

  // El enlace sólo describe su cita; uno alterado no sirve.
  const token = linkToken({ ...mail, text: mail.text.split('Entrar a la videoconsulta: ')[1] });
  const info = await linkPost('info', { token });
  assert.equal(info.status, 200);
  assert.deepEqual([info.body.doctor.displayName, info.body.open, info.body.consentGiven], ['Dra. Ana', false, false]);
  assert.equal((await linkPost('info', { token: token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A') })).status, 404);
  // Antes de la ventana no abre la sala.
  assert.equal((await linkPost('join', { token, consent: true })).status, 409);

  // Una cita presencial no tiene sala.
  const presencial = (await book(ana, videoService, localIso(monday, '10:00'))).body.appointment;
  assert.equal(presencial.modality, 'IN_PERSON');
  assert.equal((await ana.get(`/api/patient/appointments/${presencial.id}/video`)).status, 404);
});

test('sala de espera: consentimiento, aviso al médico, médico anfitrión y cierre de la ventana', async () => {
  const ana = await registerPatient(h.base, 'Ana');
  const id = (await book(ana, videoService, localIso(nextMonday(), '09:00'), 'VIDEO')).body.appointment.id;
  await moveTo(id, 10);

  // Sin consentimiento no entra; con él, queda registrado (una sola vez) y recibe su pase.
  assert.equal((await ana.post(`/api/patient/appointments/${id}/video/join`, {})).status, 400);
  const joined = await ana.post(`/api/patient/appointments/${id}/video/join`, { consent: true });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.equal(joined.body.url, `https://medora.daily.test/medora-${id}`);
  const stored = await h.prisma.appointment.findUniqueOrThrow({ where: { id } });
  assert.equal(stored.videoConsentVersion, 'tele-2026-10');
  assert.ok(stored.patientJoinedAt);
  assert.equal((await ana.post(`/api/patient/appointments/${id}/video/join`, {})).status, 200, 'el consentimiento ya dado basta');
  assert.deepEqual(h.video.tokens.map((t) => [t.userName, t.owner]), [['Ana', false], ['Ana', false]]);
  // La sala existe sólo de 15 min antes a 30 min después de la cita.
  const room = h.video.rooms.get(`medora-${id}`)!;
  assert.equal(room.notBefore.getTime(), stored.startsAt.getTime() - 15 * 60_000);
  assert.equal(room.expires.getTime(), stored.endsAt.getTime() + 30 * 60_000);

  // El médico ve en su agenda que el paciente ya espera.
  const day = DateTime.fromJSDate(stored.startsAt, { zone: TZ }).toISODate();
  let row = (await owner.get(`/api/clinic/appointments?from=${day}`)).body.appointments.find((x: { id: string }) => x.id === id);
  assert.deepEqual([row.modality, row.patientWaiting], ['VIDEO', true]);
  await h.prisma.appointment.update({ where: { id }, data: { patientSeenAt: new Date(Date.now() - 2 * 60_000) } });
  row = (await owner.get(`/api/clinic/appointments?from=${day}`)).body.appointments.find((x: { id: string }) => x.id === id);
  assert.equal(row.patientWaiting, false, 'sin señales de vida ya no cuenta como en espera');
  assert.equal((await ana.post(`/api/patient/appointments/${id}/video/heartbeat`)).body.ok, true);
  assert.equal(VideoService.waiting((await h.prisma.appointment.findUniqueOrThrow({ where: { id } }))), true);

  // Sólo el médico de la cita (o dirección) entra como anfitrión; recepción y otros médicos no.
  const doctor = await addStaff(h, owner, { name: 'Ana López', email: 'ana@clinica.mx', role: 'DOCTOR', password: 'medico-seguro-123' });
  await owner.patch(`/api/clinic/doctors/${doctorId}`, { membershipId: doctor.membershipId });
  const otherDoctorId = (await owner.post('/api/clinic/doctors', { displayName: 'Dr. Luis', specialty: 'Pediatría', serviceIds: [videoService] })).body.id;
  const luis = await addStaff(h, owner, { name: 'Luis', email: 'luis@clinica.mx', role: 'DOCTOR', password: 'medico-seguro-123' });
  await owner.patch(`/api/clinic/doctors/${otherDoctorId}`, { membershipId: luis.membershipId });
  await addStaff(h, owner, { name: 'Recepción', email: 'rec@clinica.mx', role: 'RECEPTION', password: 'recepcion-segura-1' });
  const anaDoc = await loginStaff(h.base, 'ana@clinica.mx', 'medico-seguro-123', SLUG);
  const luisDoc = await loginStaff(h.base, 'luis@clinica.mx', 'medico-seguro-123', SLUG);
  const rec = await loginStaff(h.base, 'rec@clinica.mx', 'recepcion-segura-1', SLUG);
  assert.equal((await rec.post(`/api/clinic/appointments/${id}/video/join`)).status, 403);
  assert.equal((await luisDoc.post(`/api/clinic/appointments/${id}/video/join`)).status, 403);
  const host = await anaDoc.post(`/api/clinic/appointments/${id}/video/join`);
  assert.equal(host.status, 200);
  assert.deepEqual(h.video.tokens.at(-1)!.owner, true);
  assert.equal(h.video.tokens.at(-1)!.userName, 'Dra. Ana');
  assert.equal((await anaDoc.get(`/api/clinic/appointments/${id}/video`)).body.patientWaiting, true);
  // Tras la consulta la marca como atendida; la sala ya no abre.
  await h.prisma.appointment.update({ where: { id }, data: { startsAt: new Date(Date.now() - 20 * 60_000), endsAt: new Date(Date.now() + 10 * 60_000) } });
  assert.equal((await anaDoc.post(`/api/clinic/appointments/${id}/outcome`, { status: 'COMPLETED', expectedStatus: 'BOOKED' })).status, 200);
  assert.equal((await ana.post(`/api/patient/appointments/${id}/video/join`, {})).status, 409);

  // Una cita que ya cerró su ventana tampoco abre.
  const late = (await book(ana, videoService, localIso(nextMonday(), '11:00'), 'VIDEO')).body.appointment.id;
  await moveTo(late, -70);
  assert.equal((await ana.post(`/api/patient/appointments/${late}/video/join`, { consent: true })).status, 409);
  // Otro paciente no la ve.
  assert.equal((await (await registerPatient(h.base, 'Luis')).get(`/api/patient/appointments/${id}/video`)).status, 404);
});

test('el enlace del correo sirve sin cuenta; al reprogramar la sala se mueve con la cita', async () => {
  const ana = await registerPatient(h.base, 'Ana');
  const id = (await book(ana, videoService, localIso(nextMonday(), '09:00'), 'VIDEO')).body.appointment.id;
  const token = h.app.get(VideoService).linkToken(id);
  await moveTo(id, 5);
  assert.equal((await linkPost('join', { token })).status, 400, 'pide consentimiento');
  const joined = await linkPost('join', { token, consent: true });
  assert.equal(joined.status, 200);
  assert.equal((await linkPost('heartbeat', { token })).body.ok, true);
  // Sin Origin del sitio, no.
  const noOrigin = await fetch(`${h.base}/api/video/link/info`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.equal(noOrigin.status, 403);

  // Reprogramada: la siguiente entrada actualiza la ventana de la sala.
  const monday = nextMonday();
  const current = await h.prisma.appointment.findUniqueOrThrow({ where: { id } });
  const moved = await owner.post(`/api/clinic/appointments/${id}/reschedule`, { startsAt: localIso(monday, '12:00'), expectedStartsAt: current.startsAt.toISOString() });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal((await linkPost('join', { token })).status, 409, 'ahora abre hasta el nuevo horario');
  await moveTo(id, 2);
  assert.equal((await linkPost('join', { token })).status, 200);
  const reopened = await h.prisma.appointment.findUniqueOrThrow({ where: { id } });
  assert.equal(h.video.rooms.get(`medora-${id}`)!.expires.getTime(), reopened.endsAt.getTime() + 30 * 60_000);

  // Cancelada: el enlace ya no abre la sala.
  await owner.post(`/api/clinic/appointments/${id}/cancel`, { reason: 'Reprogramar después' });
  assert.equal((await linkPost('join', { token })).status, 409);
});
