import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { DateTime } from 'luxon';
import {
  Client, Harness, TZ, WEBHOOK_SECRET, createClinicWithOwner, localIso, loginStaff, nextMonday, randomUUID,
  registerPatient, resetDb, startHarness,
} from './harness';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const SLUG = 'clinica-pagos';
let owner: Client;
let serviceId: string;
let doctorId: string;
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 }));

beforeEach(async () => {
  await resetDb(h.prisma);
  await h.prisma.$executeRawUnsafe('TRUNCATE "PaymentWebhookEvent"');
  h.payments.sessions.clear();
  h.payments.refunds = [];
  h.payments.refundFailure = null;
  const created = await createClinicWithOwner(h.prisma, SLUG);
  owner = await loginStaff(h.base, created.email, created.password, SLUG);
  serviceId = (await owner.post('/api/clinic/services', { name: 'Consulta', durationMinutes: 30, priceCents: 80000 })).body.id;
  doctorId = (await owner.post('/api/clinic/doctors', { displayName: 'Dra. Ana', specialty: 'Cardiología', serviceIds: [serviceId] })).body.id;
  await owner.put(`/api/clinic/doctors/${doctorId}/schedule`, { rules: ALL_WEEK });
  const r = await owner.patch('/api/clinic', { paymentMode: 'REQUIRED', depositPercent: 50, refundMinMinutes: 1440 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await h.deliver();
});

let seq = 0;
/** Envía un evento firmado como lo haría Stripe. */
async function webhook(type: string, object: object, id = `evt_${++seq}`, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify({ id, object: 'event', type, data: { object } });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  const res = await fetch(`${h.base}/api/payments/stripe/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body: payload,
  });
  return { status: res.status, body: await res.json() };
}

async function book(patient: Client, startsAt: string) {
  const r = await patient.post(`/api/public/clinics/${SLUG}/appointments`, {
    requestId: randomUUID(), doctorId, serviceId, startsAt,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.appointment;
}

async function payNow(patient: Client, appointmentId: string, method = 'card') {
  const c = await patient.post(`/api/patient/appointments/${appointmentId}/checkout`);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const id = c.body.url.split('/').pop();
  h.payments.set(id, 'paid', method);
  assert.equal((await webhook('checkout.session.completed', { id, object: 'checkout.session' })).status, 200);
  return id as string;
}

const slotsAt = async (date: string) => (await new Client(h.base).get(
  `/api/public/clinics/${SLUG}/doctors/${doctorId}/availability?serviceId=${serviceId}&from=${date}&days=1`,
)).body.days[0].slots.map((s: { time: string }) => s.time) as string[];

test('pago obligatorio: aparta el horario, el pago confirma la cita y un webhook repetido no duplica nada', async () => {
  const monday = nextMonday();
  const ana = await registerPatient(h.base, 'Ana');
  const profile = (await new Client(h.base).get(`/api/public/clinics/${SLUG}`)).body;
  assert.deepEqual(profile.clinic.payment, { mode: 'REQUIRED', depositPercent: 50, refundMinMinutes: 1440, asyncPayments: false, minChargeCents: 1000 });

  await h.deliver(); // confirmación de correo del registro
  const a = await book(ana, localIso(monday, '09:00'));
  assert.equal(a.status, 'PENDING_PAYMENT');
  assert.ok(a.paymentDueAt);
  assert.ok(!(await slotsAt(monday)).includes('09:00'), 'el apartado bloquea el horario');
  assert.deepEqual((await h.deliver()).map((e) => e.subject), [], 'sin confirmación hasta pagar');

  const c1 = await ana.post(`/api/patient/appointments/${a.id}/checkout`);
  const c2 = await ana.post(`/api/patient/appointments/${a.id}/checkout`);
  assert.equal(c1.body.url, c2.body.url, 'reutiliza la sesión abierta');
  const sessionId = c1.body.url.split('/').pop();
  const session = h.payments.sessions.get(sessionId)!;
  assert.equal(session.request.amountCents, 40000);
  assert.deepEqual(session.request.methods, ['card']);
  // Otro paciente no puede pagar (ni ver) la cita.
  assert.equal((await (await registerPatient(h.base, 'Luis')).post(`/api/patient/appointments/${a.id}/checkout`)).status, 404);

  // Firma inválida.
  assert.equal((await webhook('checkout.session.completed', { id: sessionId }, 'evt_x', 'whsec_otro')).status, 400);
  // Evento antes de pagar: no cambia nada.
  assert.equal((await webhook('checkout.session.completed', { id: sessionId })).status, 200);
  assert.equal((await h.prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status, 'PENDING_PAYMENT');

  h.payments.set(sessionId, 'paid');
  const first = await webhook('checkout.session.completed', { id: sessionId }, 'evt_pagado');
  assert.deepEqual(first.body, { received: true });
  const again = await webhook('checkout.session.completed', { id: sessionId }, 'evt_pagado');
  assert.deepEqual(again.body, { received: true, duplicate: true });
  // Otro evento distinto sobre la misma sesión tampoco duplica.
  await webhook('checkout.session.async_payment_succeeded', { id: sessionId });

  const stored = await h.prisma.appointment.findUniqueOrThrow({ where: { id: a.id }, include: { payments: true, events: true } });
  assert.equal(stored.status, 'BOOKED');
  assert.equal(stored.paymentDueAt, null);
  assert.deepEqual(stored.payments.map((p) => [p.status, p.amountCents, p.method]), [['PAID', 40000, 'card']]);
  assert.equal(stored.events.filter((e) => e.type === 'PAID').length, 1);
  const mails = (await h.deliver()).filter((e) => /Cita/.test(e.subject));
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /Cita confirmada/);
  assert.match(mails[0].text, /Pagado en línea: \$400\.00/);
  assert.equal((await ana.post(`/api/patient/appointments/${a.id}/checkout`)).status, 409);

  const list = (await ana.get('/api/patient/appointments')).body.upcoming[0];
  assert.deepEqual([list.payment.status, list.canPay, list.refundOnCancel], ['PAID', false, true]);
  const agenda = (await owner.get(`/api/clinic/appointments?from=${monday}`)).body.appointments[0];
  assert.equal(agenda.payment.status, 'PAID');
});

test('sin pago a tiempo la cita se cancela y el horario se libera; un pago tardío se reembolsa', async () => {
  const monday = nextMonday();
  const ana = await registerPatient(h.base, 'Ana');
  const a = await book(ana, localIso(monday, '10:00'));
  const c = await ana.post(`/api/patient/appointments/${a.id}/checkout`);
  const sessionId = c.body.url.split('/').pop();
  const due = (await h.prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).paymentDueAt!;
  const sentBefore = h.mail.sent.length;

  await h.jobs.runOnce(new Date(due.getTime() - 60_000));
  assert.equal((await h.prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status, 'PENDING_PAYMENT');
  await h.jobs.runOnce(new Date(due.getTime() + 2 * 60_000));
  const cancelled = await h.prisma.appointment.findUniqueOrThrow({ where: { id: a.id }, include: { events: true } });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.cancelReason, 'No se recibió el pago a tiempo');
  assert.equal(cancelled.events.at(-1)!.actorKind, 'SYSTEM');
  assert.ok((await slotsAt(monday)).includes('10:00'), 'el horario vuelve a estar disponible');
  await h.jobs.runOnce(); // cierra la sesión en Stripe
  assert.equal(h.payments.sessions.get(sessionId)!.state, 'expired');
  await h.deliver();
  assert.match(h.mail.sent.slice(sentBefore).map((e) => e.subject).join(), /Cita cancelada/);

  // Pago tardío (p. ej. la sesión se pagó justo al vencer): se reembolsa completo.
  h.payments.set(sessionId, 'paid');
  await webhook('checkout.session.completed', { id: sessionId });
  assert.equal((await h.prisma.payment.findFirstOrThrow()).status, 'REFUND_PENDING');
  const mails = await h.deliver();
  assert.deepEqual(h.payments.refunds.map((r) => r.amountCents), [40000]);
  const p = await h.prisma.payment.findFirstOrThrow();
  assert.deepEqual([p.status, p.refundedCents, p.refundReason], ['REFUNDED', 40000, 'La cita ya estaba cancelada']);
  assert.match(mails.map((e) => e.subject).join(), /Reembolso de \$400\.00/);
});

test('reembolsos según la política: a tiempo sí, tarde no; si cancela la clínica siempre', async () => {
  await owner.patch('/api/clinic', { refundMinMinutes: 2880 });
  const ana = await registerPatient(h.base, 'Ana');
  const monday = nextMonday();
  const tomorrow = DateTime.now().setZone(TZ).plus({ days: 1 }).toISODate()!;

  // A tiempo (más de 48 h antes): se reembolsa.
  const early = await book(ana, localIso(monday, '11:00'));
  await payNow(ana, early.id);
  assert.equal((await ana.post(`/api/patient/appointments/${early.id}/cancel`, {})).status, 200);
  await h.deliver();
  assert.deepEqual(h.payments.refunds.map((r) => r.amountCents), [40000]);

  // Tarde (mañana, menos de 48 h): no hay reembolso y el correo lo dice.
  const late = await book(ana, localIso(tomorrow, '12:00'));
  await payNow(ana, late.id);
  await h.deliver();
  assert.equal((await ana.get('/api/patient/appointments')).body.upcoming.find((x: { id: string }) => x.id === late.id).refundOnCancel, false);
  await ana.post(`/api/patient/appointments/${late.id}/cancel`, {});
  const cancelMail = (await h.deliver()).find((e) => /Cita cancelada/.test(e.subject))!;
  assert.match(cancelMail.text, /Reembolso: No aplica/);
  assert.equal(h.payments.refunds.length, 1);
  assert.equal((await h.prisma.payment.findFirstOrThrow({ where: { appointmentId: late.id } })).status, 'PAID');

  // La clínica cancela: reembolso completo aunque falte poco.
  const third = await book(ana, localIso(tomorrow, '13:00'));
  await payNow(ana, third.id);
  await owner.post(`/api/clinic/appointments/${third.id}/cancel`, { reason: 'El médico no podrá asistir' });
  await h.deliver();
  assert.equal(h.payments.refunds.length, 2);

  // Un apartado sin pagar se puede soltar aunque falte poco.
  const hold = await book(ana, localIso(tomorrow, '14:00'));
  assert.equal((await ana.post(`/api/patient/appointments/${hold.id}/cancel`, {})).status, 200);
});

test('pago opcional, OXXO, reembolsos manuales y conciliación', async () => {
  await owner.patch('/api/clinic', { paymentMode: 'OPTIONAL', asyncPaymentsEnabled: true });
  const ana = await registerPatient(h.base, 'Ana');
  const monday = nextMonday();

  // Opcional: queda agendada y confirmada al momento; puede pagar después.
  const a = await book(ana, localIso(monday, '09:00'));
  assert.equal(a.status, 'BOOKED');
  assert.match((await h.deliver()).map((e) => e.subject).join(), /Cita confirmada/);
  assert.equal((await ana.get('/api/patient/appointments')).body.upcoming[0].canPay, true);

  // OXXO (cita a 7 días o más): la ficha emitida deja el pago en proceso; al depositar, queda pagada.
  const c = await ana.post(`/api/patient/appointments/${a.id}/checkout`);
  const sessionId = c.body.url.split('/').pop();
  assert.deepEqual(h.payments.sessions.get(sessionId)!.request.methods, ['card', 'oxxo', 'spei']);
  h.payments.set(sessionId, 'voucher', 'oxxo');
  await webhook('checkout.session.completed', { id: sessionId });
  assert.equal((await h.prisma.payment.findFirstOrThrow()).status, 'PROCESSING');
  assert.equal((await ana.post(`/api/patient/appointments/${a.id}/checkout`)).status, 409);
  h.payments.set(sessionId, 'paid', 'oxxo');
  await webhook('checkout.session.async_payment_succeeded', { id: sessionId });
  const paid = await h.prisma.payment.findFirstOrThrow();
  assert.deepEqual([paid.status, paid.method], ['PAID', 'oxxo']);
  assert.match((await h.deliver()).map((e) => e.text).join(), /Pagado en línea/);

  // La clínica cancela pero Stripe no puede reembolsar (OXXO): queda para atención manual.
  h.payments.refundFailure = true;
  await owner.post(`/api/clinic/appointments/${a.id}/cancel`, { reason: 'Clínica cerrada' });
  await h.deliver();
  const stuck = await h.prisma.payment.findFirstOrThrow();
  assert.equal(stuck.status, 'REFUND_PENDING');
  assert.match(stuck.lastError!, /rechazado/);

  const today = DateTime.now().setZone(TZ).toISODate()!;
  const report = (await owner.get(`/api/clinic/payments?from=${today}&to=${today}`)).body;
  assert.equal(report.totals.chargedCents, 40000);
  assert.match(report.payments[0].attention, /Reembolso con error/);

  const manual = await owner.post(`/api/clinic/payments/${stuck.id}/manual-refund`);
  assert.equal(manual.body.status, 'REFUNDED');
  const after = (await owner.get(`/api/clinic/payments?from=${today}&to=${today}`)).body;
  assert.deepEqual([after.totals.refundedCents, after.totals.netCents, after.payments[0].attention], [40000, 0, null]);

  // Reembolso hecho desde el panel de Stripe (otra cita): llega por webhook.
  h.payments.refundFailure = null;
  const b = await book(ana, localIso(monday, '10:00'));
  const s2 = await payNow(ana, b.id);
  const intent = h.payments.sessions.get(s2)!.paymentIntentId;
  await webhook('charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: intent, amount_refunded: 40000 });
  assert.equal((await h.prisma.payment.findFirstOrThrow({ where: { appointmentId: b.id } })).status, 'REFUNDED');

  // Recepción no ve la conciliación.
  assert.equal((await new Client(h.base).get(`/api/clinic/payments?from=${today}&to=${today}`)).status, 401);
});
