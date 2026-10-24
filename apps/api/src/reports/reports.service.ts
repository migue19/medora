import { BadRequestException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma.service';
import { localInstant } from '../scheduling/availability';
import type { Cell } from './xlsx';

export interface ReportFilter { from: string; to: string; doctorId?: string; locationId?: string }

/** Canal de origen de una cita: recepción (teléfono o mostrador) o el canal en línea. */
export const ORIGIN_LABEL: Record<string, string> = {
  recepcion: 'Recepción (teléfono o mostrador)', web: 'Página de la clínica', widget: 'Sitio web de la clínica',
  google: 'Google', instagram: 'Instagram', directorio: 'Directorio de Tepahti',
};
const STATUS_LABEL: Record<string, string> = {
  BOOKED: 'Agendada', COMPLETED: 'Atendida', NO_SHOW: 'No asistió', CANCELLED: 'Cancelada', PENDING_PAYMENT: 'Pendiente de pago',
};
const ACTOR_LABEL: Record<string, string> = { PATIENT: 'Paciente', STAFF: 'Clínica', SYSTEM: 'Automática (sin pago)' };

const origin = (a: { source: string; channel: string | null }) => (a.source === 'STAFF' ? 'recepcion' : a.channel ?? 'web');
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const minutes = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / 60_000);

/**
 * Indicadores de un periodo. Definiciones (las mismas que muestra el panel):
 * - Citas: las del periodo por fecha de inicio, sin contar canceladas ni apartados sin pagar.
 * - Inasistencia: «no asistió» / (atendidas + no asistió), sólo citas con resultado registrado.
 * - Cancelaciones: con su anticipación (inicio de la cita − momento de cancelar) y quién canceló.
 * - Ocupación: minutos agendados (agendadas, atendidas y no asistió) / minutos de horario del médico, sin días bloqueados.
 * - Ingresos: precio de las citas atendidas; cobrado en línea: pagos con Stripe del periodo menos reembolsos.
 * - Pacientes nuevos: su primera cita en la clínica cae en el periodo; recurrentes: ya tenían una antes.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private range(tz: string, f: ReportFilter) {
    const from = DateTime.fromISO(f.from, { zone: tz }).startOf('day');
    const to = DateTime.fromISO(f.to, { zone: tz }).startOf('day').plus({ days: 1 });
    if (!from.isValid || !to.isValid || to <= from) throw new BadRequestException('Periodo inválido');
    if (to.diff(from, 'days').days > 370) throw new BadRequestException('El periodo puede ser de hasta un año');
    return { from, to };
  }

  private appointments(clinicId: string, from: Date, to: Date, f: ReportFilter) {
    return this.prisma.appointment.findMany({
      where: {
        clinicId, startsAt: { gte: from, lt: to },
        ...(f.doctorId ? { doctorId: f.doctorId } : {}), ...(f.locationId ? { locationId: f.locationId } : {}),
      },
      include: {
        doctor: { select: { id: true, displayName: true } },
        clinicPatient: { select: { id: true, name: true, phone: true } },
        location: { select: { name: true } },
        payments: { where: { paidAt: { not: null } }, select: { amountCents: true, refundedCents: true, status: true } },
        events: { where: { type: 'CANCELLED' }, select: { createdAt: true, actorKind: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  async summary(clinicId: string, f: ReportFilter) {
    const clinic = await this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } });
    const tz = clinic.timezone;
    const { from, to } = this.range(tz, f);
    const rows = await this.appointments(clinicId, from.toJSDate(), to.toJSDate(), f);
    const active = rows.filter((a) => a.status !== 'CANCELLED' && a.status !== 'PENDING_PAYMENT');
    const completed = active.filter((a) => a.status === 'COMPLETED');
    const noShow = active.filter((a) => a.status === 'NO_SHOW');
    const cancelled = rows.filter((a) => a.status === 'CANCELLED');

    // Cancelaciones: quién y con cuánta anticipación.
    const lead = { under24h: 0, from24to72h: 0, over72h: 0 };
    const byActor: Record<string, number> = { PATIENT: 0, STAFF: 0, SYSTEM: 0 };
    for (const a of cancelled) {
      const ev = a.events[0];
      if (!ev) continue;
      byActor[ev.actorKind] = (byActor[ev.actorKind] ?? 0) + 1;
      const hours = (a.startsAt.getTime() - ev.createdAt.getTime()) / 3_600_000;
      if (hours < 24) lead.under24h++; else if (hours < 72) lead.from24to72h++; else lead.over72h++;
    }

    // Origen (sólo citas que sí se agendaron).
    const originCounts = new Map<string, number>();
    for (const a of active) originCounts.set(origin(a), (originCounts.get(origin(a)) ?? 0) + 1);

    // Pacientes nuevos o recurrentes: primera cita (no cancelada) de cada paciente en la clínica.
    const patientIds = [...new Set(active.map((a) => a.clinicPatientId))];
    const firsts = patientIds.length ? await this.prisma.appointment.groupBy({
      by: ['clinicPatientId'], where: { clinicId, clinicPatientId: { in: patientIds }, status: { notIn: ['CANCELLED', 'PENDING_PAYMENT'] } },
      _min: { startsAt: true },
    }) : [];
    const newPatients = firsts.filter((x) => x._min.startsAt && x._min.startsAt >= from.toJSDate()).length;

    // Cobros en línea del periodo (por fecha de pago), netos de reembolsos.
    const payments = await this.prisma.payment.findMany({
      where: {
        clinicId, paidAt: { gte: from.toJSDate(), lt: to.toJSDate() },
        appointment: { ...(f.doctorId ? { doctorId: f.doctorId } : {}), ...(f.locationId ? { locationId: f.locationId } : {}) },
      },
      select: { amountCents: true, refundedCents: true },
    });

    // Ocupación por médico.
    const doctors = await this.prisma.doctor.findMany({
      where: { clinicId, ...(f.doctorId ? { id: f.doctorId } : { OR: [{ active: true }, { id: { in: [...new Set(rows.map((a) => a.doctorId))] } }] }) },
      include: {
        scheduleRules: { where: f.locationId ? { locationId: f.locationId } : {} },
        timeOffs: { where: { startsAt: { lt: to.toJSDate() }, endsAt: { gt: from.toJSDate() } } },
      },
      orderBy: { displayName: 'asc' },
    });
    const doctorRows = doctors.map((d) => {
      let available = 0;
      for (let day = from; day < to; day = day.plus({ days: 1 })) {
        for (const r of d.scheduleRules.filter((x) => x.weekday === day.weekday)) {
          const s = localInstant(day, r.startMinute)?.toJSDate();
          const e = r.endMinute === 1440 ? day.plus({ days: 1 }).toJSDate() : localInstant(day, r.endMinute)?.toJSDate();
          if (!s || !e) continue;
          // Se descuentan los días bloqueados (vacaciones, cursos).
          const blocked = d.timeOffs.reduce((sum, t) => sum + minutes(new Date(Math.max(s.getTime(), t.startsAt.getTime())), new Date(Math.min(e.getTime(), t.endsAt.getTime()))), 0);
          available += Math.max(0, minutes(s, e) - blocked);
        }
      }
      const mine = active.filter((a) => a.doctorId === d.id);
      const booked = mine.reduce((sum, a) => sum + a.durationMinutes, 0);
      const done = mine.filter((a) => a.status === 'COMPLETED').length;
      const absent = mine.filter((a) => a.status === 'NO_SHOW').length;
      return {
        id: d.id, name: d.displayName, availableMinutes: Math.round(available), bookedMinutes: booked,
        occupancy: pct(booked, available), appointments: mine.length, completed: done, noShow: absent,
        noShowRate: pct(absent, done + absent), revenueCents: mine.filter((a) => a.status === 'COMPLETED').reduce((s, a) => s + a.priceCents, 0),
      };
    }).filter((d) => d.availableMinutes > 0 || d.appointments > 0);

    // Serie diaria.
    const daily: { date: string; scheduled: number; completed: number; noShow: number; cancelled: number }[] = [];
    for (let day = from; day < to; day = day.plus({ days: 1 })) {
      const date = day.toISODate()!;
      const sameDay = rows.filter((a) => DateTime.fromJSDate(a.startsAt, { zone: tz }).toISODate() === date);
      daily.push({
        date,
        scheduled: sameDay.filter((a) => a.status !== 'CANCELLED' && a.status !== 'PENDING_PAYMENT').length,
        completed: sameDay.filter((a) => a.status === 'COMPLETED').length,
        noShow: sameDay.filter((a) => a.status === 'NO_SHOW').length,
        cancelled: sameDay.filter((a) => a.status === 'CANCELLED').length,
      });
    }

    const totalBooked = doctorRows.reduce((s, d) => s + d.bookedMinutes, 0);
    const totalAvailable = doctorRows.reduce((s, d) => s + d.availableMinutes, 0);
    return {
      timezone: tz, from: f.from, to: f.to,
      totals: {
        appointments: active.length, completed: completed.length, noShow: noShow.length, cancelled: cancelled.length,
        pending: active.filter((a) => a.status === 'BOOKED').length,
        noShowRate: pct(noShow.length, completed.length + noShow.length),
        cancellationRate: pct(cancelled.length, active.length + cancelled.length),
        occupancy: pct(totalBooked, totalAvailable),
      },
      cancellations: { total: cancelled.length, byActor, lead },
      origin: [...originCounts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, label: ORIGIN_LABEL[key] ?? key, count })),
      revenue: {
        completedCents: completed.reduce((s, a) => s + a.priceCents, 0),
        scheduledCents: active.filter((a) => a.status === 'BOOKED').reduce((s, a) => s + a.priceCents, 0),
        onlineCollectedCents: payments.reduce((s, p) => s + p.amountCents - p.refundedCents, 0),
      },
      patients: { total: patientIds.length, new: newPatients, returning: patientIds.length - newPatients },
      doctors: doctorRows,
      daily,
    };
  }

  /** Detalle de citas del periodo para exportar (CSV o Excel). */
  async exportRows(clinicId: string, f: ReportFilter): Promise<Cell[][]> {
    const clinic = await this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } });
    const { from, to } = this.range(clinic.timezone, f);
    const rows = await this.appointments(clinicId, from.toJSDate(), to.toJSDate(), f);
    const header: Cell[] = ['Fecha', 'Hora', 'Médico', 'Sede', 'Paciente', 'Teléfono', 'Servicio', 'Modalidad', 'Estado', 'Origen', 'Precio', 'Cobrado en línea', 'Canceló', 'Motivo de cancelación'];
    return [header, ...rows.map((a): Cell[] => {
      const local = DateTime.fromJSDate(a.startsAt, { zone: clinic.timezone });
      const paid = a.payments.reduce((s, p) => s + p.amountCents - p.refundedCents, 0);
      return [
        local.toISODate(), local.toFormat('HH:mm'), a.doctor.displayName, a.location.name, a.clinicPatient.name, a.clinicPatient.phone,
        a.serviceName, a.modality === 'VIDEO' ? 'Videoconsulta' : 'Presencial', STATUS_LABEL[a.status] ?? a.status,
        ORIGIN_LABEL[origin(a)] ?? origin(a), a.priceCents / 100, paid ? paid / 100 : null,
        a.status === 'CANCELLED' && a.events[0] ? ACTOR_LABEL[a.events[0].actorKind] ?? a.events[0].actorKind : null, a.cancelReason,
      ];
    })];
  }
}
