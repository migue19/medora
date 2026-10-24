import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { Client, Harness, TZ, createClinicWithOwner, loginStaff, randomUUID, resetDb, startHarness } from './harness';
import { WeeklyReportService } from '../../src/reports/weekly.service';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const SLUG = 'clinica-reportes';
let owner: Client;
let clinicId: string;
const at = (date: string, time: string) => DateTime.fromISO(`${date}T${time}`, { zone: TZ }).toJSDate();

beforeEach(async () => {
  await resetDb(h.prisma);
  const created = await createClinicWithOwner(h.prisma, SLUG);
  clinicId = created.clinic.id;
  owner = await loginStaff(h.base, created.email, created.password, SLUG);
  await h.deliver();
});

/**
 * Semana del lunes 7 al domingo 13 de septiembre de 2026. Horario lunes a viernes de 9:00 a 13:00 (240 min/día),
 * con el miércoles bloqueado: 960 minutos disponibles.
 */
async function scenario() {
  const consulta = (await owner.post('/api/clinic/services', { name: 'Consulta', durationMinutes: 30, priceCents: 80000 })).body;
  const doctor = (await owner.post('/api/clinic/doctors', { displayName: 'Dra. Ana', specialty: 'Medicina general', serviceIds: [consulta.id] })).body;
  await owner.put(`/api/clinic/doctors/${doctor.id}/schedule`, { rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 780 })) });
  const user = await h.prisma.user.findFirstOrThrow();
  await h.prisma.timeOff.create({ data: { clinicId, doctorId: doctor.id, startsAt: at('2026-09-09', '00:00'), endsAt: at('2026-09-10', '00:00'), reason: 'Congreso', createdById: user.id } });
  const location = (await h.prisma.location.findFirstOrThrow({ where: { clinicId } })).id;
  const patient = async (name: string) => (await h.prisma.clinicPatient.create({ data: { clinicId, name, phone: '5511112222' } })).id;
  const [p1, p2, p3, p4] = [await patient('Paciente Uno'), await patient('Paciente Dos'), await patient('Paciente Tres'), await patient('Paciente Cuatro')];
  const appt = async (p: string, date: string, time: string, status: 'BOOKED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED' | 'PENDING_PAYMENT', opts: { source?: 'ONLINE' | 'STAFF'; channel?: string; price?: number } = {}) => {
    const startsAt = at(date, time);
    return h.prisma.appointment.create({
      data: {
        clinicId, doctorId: doctor.id, serviceId: consulta.id, clinicPatientId: p, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        status, source: opts.source ?? 'ONLINE', channel: opts.source === 'STAFF' ? null : opts.channel ?? 'web', serviceName: 'Consulta',
        durationMinutes: 30, priceCents: opts.price ?? 80000, requestKey: randomUUID(), requestHash: '0'.repeat(64), locationId: location,
        cancelReason: status === 'CANCELLED' ? 'Prueba' : null, paymentDueAt: status === 'PENDING_PAYMENT' ? new Date() : null,
      },
    });
  };
  const cancelEvent = (id: string, actorKind: 'PATIENT' | 'STAFF', when: Date) => h.prisma.appointmentEvent.create({
    data: { appointmentId: id, type: 'CANCELLED', actorKind, actorId: user.id, actorName: 'x', createdAt: when },
  });
  await appt(p2, '2026-08-20', '10:00', 'COMPLETED'); // antecedente: Paciente Dos ya era paciente
  const a1 = await appt(p1, '2026-09-07', '09:00', 'COMPLETED');
  await appt(p2, '2026-09-07', '09:30', 'NO_SHOW', { source: 'STAFF' });
  const a3 = await appt(p3, '2026-09-08', '10:00', 'COMPLETED', { channel: 'directorio', price: 60000 });
  await appt(p1, '2026-09-08', '09:00', 'PENDING_PAYMENT');
  const a4 = await appt(p1, '2026-09-10', '11:00', 'CANCELLED');
  await cancelEvent(a4.id, 'PATIENT', at('2026-09-08', '11:00')); // 48 h antes
  const a5 = await appt(p4, '2026-09-11', '09:00', 'CANCELLED', { source: 'STAFF' });
  await cancelEvent(a5.id, 'STAFF', at('2026-09-11', '07:00')); // 2 h antes
  await appt(p4, '2026-09-11', '12:00', 'BOOKED', { channel: 'google', price: 50000 });
  // Cobros en línea: 400 de la cita 3 y 400 de la cita 1 con 100 reembolsados → 700 netos.
  await h.prisma.payment.create({ data: { clinicId, appointmentId: a3.id, checkoutId: 'cs_r1', amountCents: 40000, status: 'PAID', expiresAt: new Date(), paidAt: at('2026-09-08', '10:30') } });
  await h.prisma.payment.create({ data: { clinicId, appointmentId: a1.id, checkoutId: 'cs_r2', amountCents: 40000, refundedCents: 10000, status: 'REFUNDED', expiresAt: new Date(), paidAt: at('2026-09-07', '08:00') } });
  return { doctor, location };
}

test('los indicadores de la semana cuadran con la agenda', async () => {
  const { doctor } = await scenario();
  const r = await owner.get('/api/clinic/reports/summary?from=2026-09-07&to=2026-09-13');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = r.body;
  assert.deepEqual(s.totals, {
    appointments: 4, completed: 2, noShow: 1, cancelled: 2, pending: 1, noShowRate: 33.3, cancellationRate: 33.3, occupancy: 12.5,
  });
  assert.deepEqual(s.cancellations, { total: 2, byActor: { PATIENT: 1, STAFF: 1, SYSTEM: 0 }, lead: { under24h: 1, from24to72h: 1, over72h: 0 } });
  assert.deepEqual(Object.fromEntries(s.origin.map((o: { key: string; count: number }) => [o.key, o.count])), { web: 1, recepcion: 1, directorio: 1, google: 1 });
  assert.deepEqual(s.revenue, { completedCents: 140000, scheduledCents: 50000, onlineCollectedCents: 70000 });
  assert.deepEqual(s.patients, { total: 4, new: 3, returning: 1 });
  assert.deepEqual(s.doctors.map((d: { name: string; availableMinutes: number; bookedMinutes: number; occupancy: number; noShowRate: number }) => [d.name, d.availableMinutes, d.bookedMinutes, d.occupancy, d.noShowRate]),
    [['Dra. Ana', 960, 120, 12.5, 33.3]]);
  assert.equal(s.daily.length, 7);
  assert.deepEqual(s.daily[0], { date: '2026-09-07', scheduled: 2, completed: 1, noShow: 1, cancelled: 0 });

  // Mismas cifras que la agenda del panel en esa semana.
  const agenda = (await owner.get('/api/clinic/appointments?from=2026-09-07&days=7')).body.appointments as { status: string }[];
  const count = (st: string) => agenda.filter((a) => a.status === st).length;
  assert.equal(count('COMPLETED') + count('NO_SHOW') + count('BOOKED'), s.totals.appointments);
  assert.equal(count('COMPLETED'), s.totals.completed);
  assert.equal(count('NO_SHOW'), s.totals.noShow);
  assert.equal(count('CANCELLED'), s.totals.cancelled);

  // Filtro por médico: igual (único médico); por otro médico sin citas, ceros.
  assert.equal((await owner.get(`/api/clinic/reports/summary?from=2026-09-07&to=2026-09-13&doctorId=${doctor.id}`)).body.totals.appointments, 4);
  assert.equal((await owner.get(`/api/clinic/reports/summary?from=2026-09-07&to=2026-09-13&doctorId=${randomUUID()}`)).body.totals.appointments, 0);
  assert.equal((await owner.get('/api/clinic/reports/summary?from=2026-09-13&to=2026-09-07')).status, 400);
});

test('exportación a CSV y Excel (plan Plus) y resumen semanal por correo', async () => {
  await scenario();
  const get = (path: string) => fetch(`${h.base}${path}`, { headers: { authorization: `Bearer ${owner.token}` } });
  const csvRes = await get('/api/clinic/reports/export/csv?from=2026-09-07&to=2026-09-13');
  assert.equal(csvRes.status, 200);
  const text = await csvRes.text();
  const lines = text.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines.length, 1 + 7, 'encabezado y las 7 citas del periodo (con canceladas y apartadas)');
  assert.match(lines[0], /^Fecha,Hora,Médico,Sede,Paciente/);
  assert.ok(lines.some((l) => l.includes('Directorio de Tepahti') && l.includes('Atendida')));
  assert.ok(lines.some((l) => l.includes('Cancelada') && l.includes('Paciente,Prueba')));
  const x = await get('/api/clinic/reports/export/xlsx?from=2026-09-07&to=2026-09-13');
  assert.equal(x.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(Buffer.from(await x.arrayBuffer()).subarray(0, 2).toString(), 'PK');

  // Sin plan Plus no se exporta (los indicadores sí se ven).
  await h.prisma.clinic.update({ where: { id: clinicId }, data: { billingExempt: false, plan: 'CLINICA', subscriptionStatus: 'ACTIVE' } });
  assert.equal((await get('/api/clinic/reports/export/csv?from=2026-09-07&to=2026-09-13')).status, 403);
  assert.equal((await owner.get('/api/clinic/reports/summary?from=2026-09-07&to=2026-09-13')).status, 200);

  // Resumen semanal: el lunes 14 resume la semana del 7 al 13 contra la anterior.
  const weekly = h.app.get(WeeklyReportService);
  const before = h.mail.sent.length;
  await weekly.sendAll(at('2026-09-14', '08:00'));
  const mail = h.mail.sent.slice(before).find((e) => /Tu semana en/.test(e.subject))!;
  assert.ok(mail, 'llega el resumen al propietario');
  assert.match(mail.text, /7 de septiembre al 13 de septiembre/);
  assert.match(mail.text, /Citas: 4 \(antes 0\)/);
  assert.match(mail.text, /Inasistencia: 33\.3% \(antes —\)/);
  assert.match(mail.text, /Mayor ocupación: Dra\. Ana \(12\.5%\)/);
  // Desactivado en la clínica: no se envía.
  await owner.patch('/api/clinic', { weeklyReport: false });
  const count = h.mail.sent.length;
  await weekly.sendAll(at('2026-09-14', '08:00'));
  assert.equal(h.mail.sent.length, count);
  assert.equal((await new Client(h.base).get('/api/clinic/reports/summary?from=2026-09-07&to=2026-09-13')).status, 401);
});
