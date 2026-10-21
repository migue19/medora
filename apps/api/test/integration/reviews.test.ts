import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Client, Harness, addStaff, createClinicWithOwner, linkToken, localIso, loginStaff, nextMonday, randomUUID,
  registerPatient, resetDb, startHarness,
} from './harness';
import { publicAuthor } from '../../src/reviews/reviews.service';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const SLUG = 'clinica-a';
let owner: Client;
let doctorId: string;
let otherDoctorId: string;
let serviceId: string;
let monday: string;
const ratings = { ratingPunctuality: 5, ratingTreatment: 4, ratingFacilities: 3 };
let pastVisits = 0;

beforeEach(async () => {
  await resetDb(h.prisma);
  h.mail.sent.length = 0;
  h.whatsapp.sent.length = 0;
  const created = await createClinicWithOwner(h.prisma, SLUG);
  owner = await loginStaff(h.base, created.email, created.password, SLUG);
  serviceId = (await owner.post('/api/clinic/services', { name: 'Consulta', durationMinutes: 30, priceCents: 60000 })).body.id;
  doctorId = (await owner.post('/api/clinic/doctors', { displayName: 'Dr. Juan López', specialty: 'Cardiología', serviceIds: [serviceId] })).body.id;
  otherDoctorId = (await owner.post('/api/clinic/doctors', { displayName: 'Dra. Ana', specialty: 'Pediatría', serviceIds: [serviceId] })).body.id;
  for (const id of [doctorId, otherDoctorId]) {
    await owner.put(`/api/clinic/doctors/${id}/schedule`, { rules: [{ weekday: 1, startMinute: 540, endMinute: 720 }] });
  }
  monday = nextMonday();
});

/** Reserva en línea y la lleva al pasado; con `complete` la marca como atendida desde el panel. */
async function visit(patient: Client, time: string, complete = true, doc = doctorId) {
  const r = await patient.post(`/api/public/clinics/${SLUG}/appointments`, {
    requestId: randomUUID(), doctorId: doc, serviceId, startsAt: localIso(monday, time),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.appointment.id as string;
  // Cada cita en un día distinto del pasado: el mismo médico no puede tener dos a la vez.
  const start = new Date(Date.now() - 3 * 3600_000 - ++pastVisits * 24 * 3600_000);
  await h.prisma.appointment.update({ where: { id }, data: { startsAt: start, endsAt: new Date(start.getTime() + 30 * 60_000) } });
  if (complete) assert.equal((await owner.post(`/api/clinic/appointments/${id}/outcome`, { status: 'COMPLETED', expectedStatus: 'BOOKED' })).status, 200);
  await h.deliver();
  return id;
}

/** Ejecuta la cola con 3 horas de adelanto (la invitación sale 2 h después de la cita). */
async function inviteMail() {
  const before = h.mail.sent.length;
  await h.jobs.runOnce(new Date(Date.now() + 3 * 3600_000));
  return h.mail.sent.slice(before).filter((m) => /¿Cómo fue tu consulta/.test(m.subject));
}

test('nombre público: nombre e inicial del primer apellido, o anónimo', () => {
  assert.equal(publicAuthor('Ana María Pérez López', false), 'Ana P.');
  assert.equal(publicAuthor('Beto Ruiz', false), 'Beto R.');
  assert.equal(publicAuthor('Carla', false), 'Carla');
  assert.equal(publicAuthor('Ana Pérez', true), 'Paciente verificado');
});

test('tras una cita atendida llega la invitación y la opinión se publica una sola vez', async () => {
  const ana = await registerPatient(h.base, 'Ana Pérez López');
  const id = await visit(ana, '09:00');
  const job = await h.prisma.job.findFirstOrThrow({ where: { type: 'review.invite' } });
  assert.ok(job.runAt.getTime() > Date.now() + 60 * 60_000, 'sale unas horas después, no al instante');
  assert.equal((await h.deliver()).length, 0);

  const [mail] = await inviteMail();
  assert.match(mail.subject, /¿Cómo fue tu consulta con Dr\. Juan López\?/);
  assert.match(mail.text, /\/opinion#/);
  const token = linkToken(mail);
  const anon = new Client(h.base);
  const info = await anon.post('/api/public/reviews/inspect', { token });
  assert.equal(info.body.doctor.displayName, 'Dr. Juan López');
  assert.equal(info.body.publicName, 'Ana P.');
  assert.equal(info.body.alreadyReviewed, false);

  assert.equal((await anon.post('/api/public/reviews', { token, ...ratings, ratingFacilities: 6 })).status, 400);
  assert.equal((await anon.req('POST', '/api/public/reviews', { token, ...ratings }, { origin: 'https://evil.mx' })).status, 403);
  const ok = await anon.post('/api/public/reviews', { token, ...ratings, comment: '  Muy amable y puntual.  ' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.authorName, 'Ana P.');
  assert.equal(ok.body.rating, 4);
  assert.equal(ok.body.comment, 'Muy amable y puntual.');
  // El enlace sirve una vez y la cita sólo admite una opinión, también desde el portal.
  assert.equal((await anon.post('/api/public/reviews', { token, ...ratings })).status, 400);
  assert.equal((await ana.post(`/api/patient/appointments/${id}/review`, ratings)).status, 409);
  const portal = (await ana.get('/api/patient/appointments')).body.past[0];
  assert.deepEqual([portal.reviewed, portal.canReview], [true, false]);

  const profile = (await new Client(h.base).get(`/api/public/clinics/${SLUG}`)).body;
  const juan = profile.doctors.find((d: { id: string }) => d.id === doctorId);
  assert.deepEqual(juan.rating, { count: 1, average: 4, punctuality: 5, treatment: 4, facilities: 3 });
  assert.equal(juan.reviews[0].comment, 'Muy amable y puntual.');
  assert.equal(juan.reviews[0].authorName, 'Ana P.');
  assert.equal(JSON.stringify(profile).includes('López'), true, 'el apellido sólo aparece en el nombre del médico');
  assert.equal(JSON.stringify(juan.reviews).includes((await ana.get('/api/patient/me')).body.email), false);
});

test('no se puede opinar sin una cita atendida', async () => {
  const ana = await registerPatient(h.base, 'Ana');
  const booked = await visit(ana, '09:00', false);
  assert.equal((await ana.post(`/api/patient/appointments/${booked}/review`, ratings)).status, 409);
  await owner.post(`/api/clinic/appointments/${booked}/outcome`, { status: 'NO_SHOW', expectedStatus: 'BOOKED' });
  assert.equal((await ana.post(`/api/patient/appointments/${booked}/review`, ratings)).status, 409);
  assert.equal((await inviteMail()).length, 0, 'sin cita atendida no hay invitación');
  // Otro paciente no puede opinar sobre una cita ajena.
  const done = await visit(ana, '10:00');
  const beto = await registerPatient(h.base, 'Beto');
  assert.equal((await beto.post(`/api/patient/appointments/${done}/review`, ratings)).status, 404);
  assert.equal((await new Client(h.base).post('/api/public/reviews', { token: 'x'.repeat(64), ...ratings })).status, 400);
  // Y PostgreSQL rechaza una opinión directa sobre una cita no atendida.
  const appt = await h.prisma.appointment.findUniqueOrThrow({ where: { id: booked } });
  await assert.rejects(h.prisma.review.create({
    data: {
      clinicId: appt.clinicId, doctorId: appt.doctorId, appointmentId: appt.id, clinicPatientId: appt.clinicPatientId,
      ratingPunctuality: 5, ratingTreatment: 5, ratingFacilities: 5, authorName: 'X',
    },
  }), /review_requires_completed_appointment/);
  // Desde el portal sí, sobre su cita atendida, y anónima.
  const fromPortal = await ana.post(`/api/patient/appointments/${done}/review`, { ...ratings, anonymous: true });
  assert.equal(fromPortal.status, 201);
  assert.equal(fromPortal.body.authorName, 'Paciente verificado');
});

test('moderación con motivo, aviso al paciente y bitácora; respuesta del médico', async () => {
  const ana = await registerPatient(h.base, 'Ana Pérez');
  const id = await visit(ana, '09:00');
  const review = await ana.post(`/api/patient/appointments/${id}/review`, { ...ratings, comment: 'Comentario' });
  const rid = review.body.id;
  const anaEmail = (await ana.get('/api/patient/me')).body.email;

  const rec = await addStaff(h, owner, { name: 'Rosa', email: 'rosa@test.mx', role: 'RECEPTION', password: 'recepcion-segura-1' });
  void rec;
  const rosa = await loginStaff(h.base, 'rosa@test.mx', 'recepcion-segura-1', SLUG);
  assert.equal((await rosa.post(`/api/clinic/reviews/${rid}/hide`, { reason: 'SPAM' })).status, 403);
  assert.equal((await owner.post(`/api/clinic/reviews/${rid}/hide`, { reason: 'NO_ME_GUSTA' })).status, 400);
  const hidden = await owner.post(`/api/clinic/reviews/${rid}/hide`, { reason: 'PERSONAL_DATA', note: 'Menciona a otra paciente' });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.status, 'HIDDEN');
  assert.equal(hidden.body.hiddenReason.code, 'PERSONAL_DATA');
  assert.equal((await owner.post(`/api/clinic/reviews/${rid}/hide`, { reason: 'SPAM' })).status, 409);
  const [notice] = (await h.deliver()).filter((m) => m.to === anaEmail);
  assert.match(notice.subject, /fue ocultada/);
  assert.match(notice.text, /Motivo: Incluye datos personales/);
  assert.match(notice.text, /Nota de la clínica: Menciona a otra paciente/);

  // Oculta: no cuenta en el promedio ni aparece en público, pero sigue guardada.
  const pub = (await new Client(h.base).get(`/api/public/clinics/${SLUG}`)).body.doctors.find((d: { id: string }) => d.id === doctorId);
  assert.equal(pub.rating, null);
  assert.equal(pub.reviews.length, 0);
  assert.equal(await h.prisma.review.count(), 1);

  assert.equal((await owner.post(`/api/clinic/reviews/${rid}/restore`, { note: 'Se revisó de nuevo' })).status, 200);
  assert.match((await h.deliver()).find((m) => m.to === anaEmail)!.subject, /volvió a publicarse/);

  // Responde el médico de la cita; otro médico o recepción no.
  const docMember = await addStaff(h, owner, { name: 'Juan', email: 'juan@test.mx', role: 'DOCTOR', password: 'medico-seguro-01' });
  await owner.patch(`/api/clinic/doctors/${doctorId}`, { membershipId: docMember.membershipId });
  const otherMember = await addStaff(h, owner, { name: 'Ana', email: 'ana.dra@test.mx', role: 'DOCTOR', password: 'medica-segura-01' });
  await owner.patch(`/api/clinic/doctors/${otherDoctorId}`, { membershipId: otherMember.membershipId });
  const juan = await loginStaff(h.base, 'juan@test.mx', 'medico-seguro-01', SLUG);
  const dra = await loginStaff(h.base, 'ana.dra@test.mx', 'medica-segura-01', SLUG);
  assert.equal((await dra.put(`/api/clinic/reviews/${rid}/reply`, { text: 'Gracias' })).status, 403);
  assert.equal((await rosa.put(`/api/clinic/reviews/${rid}/reply`, { text: 'Gracias' })).status, 403);
  const replied = await juan.put(`/api/clinic/reviews/${rid}/reply`, { text: 'Gracias por tu confianza, Ana.' });
  assert.equal(replied.status, 200);
  assert.equal(replied.body.reply.by, 'Juan');
  // El médico sólo ve sus opiniones.
  assert.equal((await juan.get('/api/clinic/reviews')).body.reviews.length, 1);
  assert.equal((await dra.get('/api/clinic/reviews')).body.reviews.length, 0);
  assert.equal((await juan.del(`/api/clinic/reviews/${rid}/reply`)).status, 200);
  await juan.put(`/api/clinic/reviews/${rid}/reply`, { text: 'Gracias por tu confianza.' });

  const list = (await owner.get('/api/clinic/reviews')).body;
  const events = list.reviews[0].events.map((e: { type: string }) => e.type);
  assert.deepEqual(events, ['CREATED', 'HIDDEN', 'RESTORED', 'REPLIED', 'REPLY_REMOVED', 'REPLIED']);
  assert.equal(list.reviews[0].events[1].reason, 'PERSONAL_DATA');
  assert.equal(list.reviews[0].patientName, 'Ana Pérez');
  assert.ok(list.reasons.OFFENSIVE);

  const page = (await new Client(h.base).get(`/api/public/reviews/clinics/${SLUG}/doctors/juan-lopez`)).body;
  assert.equal(page.reviews[0].reply.text, 'Gracias por tu confianza.');
  assert.equal(page.hasMore, false);
});

test('invitación por WhatsApp con consentimiento, y sin invitación si la clínica no recibe opiniones', async () => {
  await owner.patch('/api/clinic', { whatsappEnabled: true });
  const ana = await registerPatient(h.base, 'Ana');
  const me = (await ana.get('/api/patient/me')).body;
  await ana.patch('/api/patient/me', { name: me.name, phone: '55 1234 5678', whatsappConsent: true });
  await visit(ana, '09:00');
  assert.equal((await inviteMail()).length, 1);
  const wa = h.whatsapp.sent.find((m) => m.template === 'invitacion_opinion')!;
  assert.equal(wa.to, '525512345678');
  assert.equal((await new Client(h.base).post('/api/public/reviews/inspect', { token: wa.buttonParam })).status, 200);

  await owner.patch('/api/clinic', { reviewsEnabled: false });
  const beto = await registerPatient(h.base, 'Beto');
  const id = await visit(beto, '10:00');
  assert.equal(await h.prisma.job.count({ where: { type: 'review.invite' } }), 1);
  assert.equal((await beto.post(`/api/patient/appointments/${id}/review`, ratings)).status, 403);
});
