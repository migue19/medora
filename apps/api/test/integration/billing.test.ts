import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {
  Client, Harness, ORIGIN, WEBHOOK_SECRET, createClinicWithOwner, linkToken, loginStaff, randomUUID, registerPatient, resetDb,
  startHarness,
} from './harness';
import { splitVat, cfdiBody } from '../../src/billing/cfdi';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

beforeEach(async () => {
  await resetDb(h.prisma);
  await h.prisma.$executeRawUnsafe('TRUNCATE "PaymentWebhookEvent", "SubscriptionInvoice", "ClinicBilling" CASCADE');
  h.billing.customers = []; h.billing.subscriptions.clear(); h.billing.invoices.clear(); h.billing.checkouts = [];
  h.cfdi.issued = []; h.cfdi.reject = null;
  await h.deliver();
});

const PASSWORD = 'clinica-segura-123';
const signup = (body: Record<string, unknown>) => fetch(`${h.base}/api/public/signup`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN },
  body: JSON.stringify({
    clinicName: 'Consultorio Dra. Sofía', ownerName: 'Sofía Ramírez', email: 'sofia@consultorio.mx', phone: '55 1234 5678',
    plan: 'CONSULTORIO', doctorName: 'Dra. Sofía Ramírez', specialty: 'Pediatría', licenseNumber: '12345678', acceptTerms: true, ...body,
  }),
}).then(async (r) => ({ status: r.status, body: await r.json() as any }));

/** Registra la clínica y activa la cuenta del propietario con el enlace del correo. */
async function registerAndLogin(extra: Record<string, unknown> = {}) {
  assert.equal((await signup(extra)).status, 200);
  const mail = (await h.deliver()).find((e) => /Activa tu cuenta/.test(e.subject))!;
  const reset = await new Client(h.base).post('/api/auth/reset', { token: linkToken(mail), password: PASSWORD });
  assert.equal(reset.status, 204, JSON.stringify(reset.body));
  const clinic = await h.prisma.clinic.findFirstOrThrow({ where: { billingExempt: false } });
  return { clinic, owner: await loginStaff(h.base, String(extra.email ?? 'sofia@consultorio.mx'), PASSWORD, clinic.slug) };
}

let seq = 0;
async function webhook(type: string, object: object) {
  const payload = JSON.stringify({ id: `evt_b${++seq}`, object: 'event', type, data: { object } });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(`${h.base}/api/payments/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body: payload });
  assert.equal(r.status, 200, await r.text());
}

test('IVA incluido: subtotal e IVA suman exactamente el precio de cada plan', () => {
  for (const total of [49_900, 129_900, 249_900, 1_000, 33_333]) {
    const { subtotal, vat } = splitVat(total);
    assert.equal(subtotal + vat, total);
    assert.ok(Math.abs(vat - subtotal * 0.16) <= 0.5);
  }
  const body = cfdiBody({ paymentForm: '04', receiver: { rfc: 'ABC010101AB1', name: 'CLINICA SA', cfdiUse: 'G03', fiscalRegime: '601', zipCode: '03100' }, description: 'x', identification: 'MEDORA-PLUS', totalCents: 249_900 },
    { expeditionPlace: '01000', series: 'MED', resicoRetention: true });
  assert.deepEqual(body.Items[0].Taxes.map((t) => [t.Name, t.IsRetention]), [['IVA', false], ['ISR', true]], 'retención RESICO a persona moral');
  assert.equal(cfdiBody({ paymentForm: '04', receiver: { rfc: 'ABCD010101AB1', name: 'X', cfdiUse: 'G03', fiscalRegime: '612', zipCode: '03100' }, description: 'x', identification: 'x', totalCents: 1000 },
    { expeditionPlace: '01000', series: 'MED', resicoRetention: true }).Items[0].Taxes.length, 1, 'persona física: sin retención');
});

test('alta autoservicio: clínica en prueba, cuenta activada por correo y cédula por verificar', async () => {
  assert.equal((await signup({ licenseNumber: '12-34' })).status, 400);
  assert.equal((await signup({ acceptTerms: false })).status, 400);
  const { clinic, owner } = await registerAndLogin();
  assert.equal(clinic.slug, 'consultorio-dra-sofia');
  assert.deepEqual([clinic.plan, clinic.subscriptionStatus, clinic.verification], ['CONSULTORIO', 'TRIALING', 'PENDING']);
  const days = (clinic.trialEndsAt!.getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 13.9 && days <= 14);
  const doctor = await h.prisma.doctor.findFirstOrThrow({ where: { clinicId: clinic.id } });
  assert.equal(doctor.licenseNumber, '12345678');
  assert.ok(doctor.membershipId, 'el propietario es el médico');
  assert.equal((await owner.get('/api/clinic/subscription')).body.status, 'TRIALING');
  // Aviso a la administración de Medora.
  assert.ok(h.mail.sent.some((e) => e.to === 'admin@medora.test' && /Nueva clínica por verificar/.test(e.subject)));

  // Mismo correo: no crea nada y avisa al dueño de la cuenta (respuesta idéntica).
  assert.deepEqual((await signup({ clinicName: 'Otra' })).body, { ok: true });
  assert.equal(await h.prisma.clinic.count(), 1);
  assert.match((await h.deliver()).map((e) => e.subject).join(), /Ya tienes una cuenta/);

  // Sin verificar: no aparece en el directorio ni cobra en línea.
  assert.equal((await owner.patch('/api/clinic', { directoryEnabled: true })).status, 409);
});

test('límites del plan: médicos, WhatsApp, videoconsulta y cobro; al cambiar de plan se ajustan', async () => {
  const { clinic, owner } = await registerAndLogin();
  const service = (await owner.post('/api/clinic/services', { name: 'Consulta', durationMinutes: 30, priceCents: 50000 })).body.id;
  const second = await owner.post('/api/clinic/doctors', { displayName: 'Dr. Dos', specialty: 'Pediatría', serviceIds: [service] });
  assert.equal(second.status, 403);
  assert.match(second.body.message, /Consultorio incluye 1 médico/);
  assert.equal((await owner.post('/api/clinic/services', { name: 'Video', durationMinutes: 30, priceCents: 1, telemedicine: true })).status, 403);
  assert.equal((await owner.patch('/api/clinic', { whatsappEnabled: true })).status, 403);
  assert.equal((await owner.patch('/api/clinic', { paymentMode: 'OPTIONAL' })).status, 403);

  // En prueba, cambiar de plan es inmediato.
  assert.equal((await owner.post('/api/clinic/subscription/plan', { plan: 'CLINICA' })).status, 200);
  assert.equal((await owner.post('/api/clinic/doctors', { displayName: 'Dr. Dos', specialty: 'Pediatría', serviceIds: [service] })).status, 201);
  assert.equal((await owner.patch('/api/clinic', { whatsappEnabled: true })).status, 200);
  // No se puede bajar a un plan con menos médicos de los activos.
  assert.equal((await owner.post('/api/clinic/subscription/plan', { plan: 'CONSULTORIO' })).status, 409);
  const dos = await h.prisma.doctor.findFirstOrThrow({ where: { clinicId: clinic.id, displayName: 'Dr. Dos' } });
  await owner.patch(`/api/clinic/doctors/${dos.id}`, { active: false });
  assert.equal((await owner.post('/api/clinic/subscription/plan', { plan: 'CONSULTORIO' })).status, 200);
  assert.equal((await h.prisma.clinic.findUniqueOrThrow({ where: { id: clinic.id } })).whatsappEnabled, false, 'al bajar se apaga WhatsApp');
  assert.equal((await owner.patch(`/api/clinic/doctors/${dos.id}`, { active: true })).status, 403, 'tampoco se reactiva por encima del límite');
});

test('prueba vencida: deja de recibir reservas en línea hasta suscribirse; pago, factura CFDI y cambios de Stripe', async () => {
  const { clinic, owner } = await registerAndLogin({ plan: 'CLINICA' });
  const pub = (path = '') => new Client(h.base).get(`/api/public/clinics/${clinic.slug}${path}`);
  assert.equal((await pub()).body.clinic.bookingEnabled, true);
  await h.prisma.clinic.update({ where: { id: clinic.id }, data: { trialEndsAt: new Date(Date.now() - 60_000) } });
  assert.equal((await pub()).body.clinic.bookingEnabled, false);
  const patient = await registerPatient(h.base, 'Ana');
  const doctor = await h.prisma.doctor.findFirstOrThrow({ where: { clinicId: clinic.id } });
  const svc = (await owner.post('/api/clinic/services', { name: 'Consulta', durationMinutes: 30, priceCents: 50000 })).body.id;
  await owner.patch(`/api/clinic/doctors/${doctor.id}`, { serviceIds: [svc] });
  const book = await patient.post(`/api/public/clinics/${clinic.slug}/appointments`, {
    requestId: randomUUID(), doctorId: doctor.id, serviceId: svc, startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 14) + '00:00.000Z',
  });
  assert.equal(book.status, 403);

  // Se suscribe: Stripe Checkout con su plan.
  const co = await owner.post('/api/clinic/subscription/checkout', { plan: 'CLINICA' });
  assert.equal(co.status, 200, JSON.stringify(co.body));
  assert.deepEqual([h.billing.checkouts[0].plan, h.billing.checkouts[0].trialEnd], ['CLINICA', null], 'prueba vencida: se cobra de una vez');
  const customer = h.billing.checkouts[0].customerId;
  const periodEnd = new Date(Date.now() + 30 * 86_400_000);
  h.billing.subscriptions.set('sub_1', { id: 'sub_1', customerId: customer, status: 'active', plan: 'CLINICA', currentPeriodEnd: periodEnd, trialEnd: null, cancelAtPeriodEnd: false, clinicId: clinic.id });
  await webhook('checkout.session.completed', { id: 'cs_sub', object: 'checkout.session', mode: 'subscription', subscription: 'sub_1', metadata: { clinicId: clinic.id } });
  let c = await h.prisma.clinic.findUniqueOrThrow({ where: { id: clinic.id } });
  assert.deepEqual([c.subscriptionStatus, c.stripeSubscriptionId], ['ACTIVE', 'sub_1']);
  assert.equal((await pub()).body.clinic.bookingEnabled, true);

  // Cobro: se registra una vez y, sin datos fiscales, queda sin factura.
  h.billing.invoices.set('in_1', { id: 'in_1', subscriptionId: 'sub_1', customerId: customer, status: 'paid', amountPaid: 129_900, periodStart: new Date(), periodEnd, paidAt: new Date(), cardFunding: 'debit', plan: 'CLINICA' });
  await webhook('invoice.paid', { id: 'in_1', object: 'invoice' });
  await webhook('invoice.paid', { id: 'in_1', object: 'invoice' });
  await h.deliver();
  assert.equal(await h.prisma.subscriptionInvoice.count(), 1);
  let inv = await h.prisma.subscriptionInvoice.findFirstOrThrow();
  assert.deepEqual([inv.cfdiStatus, inv.cfdiError], ['SKIPPED', 'Sin datos fiscales registrados']);

  // Registra sus datos fiscales y pide la factura: se timbra y le llega con PDF y XML.
  assert.equal((await owner.put('/api/clinic/subscription/billing', { rfc: 'XAXX01010', legalName: 'X', fiscalRegime: '601', zipCode: '03100', email: 'f@x.mx' })).status, 400);
  assert.equal((await owner.put('/api/clinic/subscription/billing', { rfc: 'CDS210101AB1', legalName: 'Consultorio Dra Sofia', fiscalRegime: '601', zipCode: '03100', email: 'facturas@consultorio.mx' })).status, 200);
  assert.equal((await owner.post(`/api/clinic/subscription/invoices/${inv.id}/cfdi`)).status, 200);
  const before = h.mail.sent.length;
  await h.deliver(); await h.deliver();
  inv = await h.prisma.subscriptionInvoice.findFirstOrThrow();
  assert.deepEqual([inv.cfdiStatus, inv.cfdiUuid], ['ISSUED', 'UUID-1']);
  const req = h.cfdi.issued[0].req;
  assert.deepEqual([req.paymentForm, req.receiver.rfc, req.receiver.name, req.totalCents], ['28', 'CDS210101AB1', 'CONSULTORIO DRA SOFIA', 129_900]);
  const mail = h.mail.sent.slice(before).find((e) => e.to === 'facturas@consultorio.mx')!;
  assert.match(mail.subject, /Tu factura de Medora/);
  assert.deepEqual(mail.attachments!.map((a) => [a.contentType, a.encoding]), [['application/pdf', 'base64'], ['application/xml', 'base64']]);
  const pdf = await fetch(`${h.base}/api/clinic/subscription/invoices/${inv.id}/pdf`, { headers: { authorization: `Bearer ${owner.token}` } });
  assert.equal((await pdf.text()).startsWith('%PDF'), true);

  // Un rechazo del PAC (datos inválidos) queda como factura fallida, sin reintentos.
  h.cfdi.reject = 'Facturama 400: El RFC del receptor no está en la lista de RFC inscritos';
  h.billing.invoices.set('in_2', { ...h.billing.invoices.get('in_1')!, id: 'in_2' });
  await webhook('invoice.paid', { id: 'in_2', object: 'invoice' });
  await h.deliver();
  const failed = await h.prisma.subscriptionInvoice.findFirstOrThrow({ where: { stripeInvoiceId: 'in_2' } });
  assert.deepEqual([failed.cfdiStatus, /no está en la lista/.test(failed.cfdiError!)], ['FAILED', true]);

  // Stripe cambia el plan (portal) y luego falla un cobro: sigue operando en el periodo de gracia.
  h.billing.subscriptions.get('sub_1')!.plan = 'PLUS';
  await webhook('customer.subscription.updated', { id: 'sub_1', object: 'subscription' });
  c = await h.prisma.clinic.findUniqueOrThrow({ where: { id: clinic.id } });
  assert.equal(c.plan, 'PLUS');
  h.billing.subscriptions.get('sub_1')!.status = 'past_due';
  h.billing.invoices.set('in_3', { ...h.billing.invoices.get('in_1')!, id: 'in_3', status: 'open', amountPaid: 0, paidAt: null });
  await webhook('invoice.payment_failed', { id: 'in_3', object: 'invoice' });
  c = await h.prisma.clinic.findUniqueOrThrow({ where: { id: clinic.id } });
  assert.equal(c.subscriptionStatus, 'PAST_DUE');
  assert.equal((await pub()).body.clinic.bookingEnabled, true, 'en periodo de gracia');
  // Cancelada: deja de recibir reservas, pero su información sigue disponible en el panel.
  h.billing.subscriptions.get('sub_1')!.status = 'canceled';
  await webhook('customer.subscription.deleted', { id: 'sub_1', object: 'subscription' });
  assert.equal((await pub()).body.clinic.bookingEnabled, false);
  assert.equal((await owner.get('/api/clinic/patients')).status, 200);
});

test('administración de Medora: verificar o rechazar la cédula; sólo superadministradores', async () => {
  const { clinic, owner } = await registerAndLogin();
  assert.equal((await owner.get('/api/admin/clinics')).status, 403);
  const adminClinic = await createClinicWithOwner(h.prisma, 'medora-hq');
  await h.prisma.user.update({ where: { email: adminClinic.email }, data: { email: 'admin@medora.test' } });
  const admin = await loginStaff(h.base, 'admin@medora.test', adminClinic.password, 'medora-hq');
  const list = (await admin.get('/api/admin/clinics')).body as { id: string; doctors: { licenseNumber: string }[]; verification: string }[];
  const row = list.find((c) => c.id === clinic.id)!;
  assert.deepEqual([row.verification, row.doctors[0].licenseNumber], ['PENDING', '12345678']);
  assert.equal((await admin.patch(`/api/admin/clinics/${clinic.id}`, { verification: 'REJECTED' })).status, 409, 'el rechazo necesita motivo');
  await h.deliver();
  assert.equal((await admin.patch(`/api/admin/clinics/${clinic.id}`, { verification: 'VERIFIED' })).status, 200);
  assert.match((await h.deliver()).map((e) => e.subject).join(), /quedó verificada/);
  assert.equal((await owner.patch('/api/clinic', { directoryEnabled: true })).status, 200, 'verificada ya puede aparecer en el directorio');
  // Exentar (cortesía): todo incluido sin cobro.
  await admin.patch(`/api/admin/clinics/${clinic.id}`, { billingExempt: true });
  assert.equal((await owner.patch('/api/clinic', { whatsappEnabled: true })).status, 200);
  assert.equal((await owner.post('/api/clinic/subscription/checkout', { plan: 'PLUS' })).status, 409);
});
