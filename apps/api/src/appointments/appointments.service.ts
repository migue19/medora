import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { ActorKind, Appointment, AppointmentSource, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService, Tx } from '../prisma.service';
import { canonicalHash } from '../common/crypto';
import { Interval, computeSlots, parseLocalDate, ruleAt } from '../scheduling/availability';
import { pricesFor, resolvePrice } from '../scheduling/pricing';
import { MailService } from '../mail/mail.service';
import { RemindersService } from '../notifications/reminders.service';
import { JobsService } from '../jobs/jobs.service';
import { ReviewsService } from '../reviews/reviews.service';
import { APP_CONFIG, AppConfig } from '../config';
import { canBookOnline } from '../billing/plans';
import { PAYMENT_EXPIRE_JOB, PAYMENT_HOLD_MINUTES, requiresPayment, settleOnCancel } from '../payments/policy';

/** Trabajo que ofrece un horario liberado a la lista de espera (lo atiende WaitlistService). */
export const WAITLIST_OFFER_JOB = 'waitlist.offer';

export const MAX_FUTURE_ONLINE_APPOINTMENTS = 3;
/** Citas vigentes: agendadas o apartadas en espera de pago. */
export const ACTIVE_STATUSES = ['BOOKED', 'PENDING_PAYMENT'] as const;
/** Actor de los procesos automáticos (vencimiento de pagos). */
export const SYSTEM_ACTOR = { kind: 'SYSTEM' as const, id: '00000000-0000-0000-0000-000000000000', name: 'Medora' };
export const MAX_AVAILABILITY_DAYS = 14;

export interface Actor {
  kind: ActorKind;
  id: string;
  name: string;
}

/** Serializa escrituras de agenda por médico (citas, bloqueos, horario). */
export async function lockDoctor(tx: Tx, doctorId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${doctorId}, 7))`;
}

function isDoubleBooking(e: unknown): boolean {
  const text = e instanceof Error ? `${e.message} ${JSON.stringify((e as { meta?: unknown }).meta ?? {})}` : '';
  return text.includes('Appointment_no_double_booking') || text.includes('23P01');
}

const SLOT_TAKEN = 'Ese horario ya no está disponible. Elige otro.';

export interface BookingInput {
  clinicId: string;
  doctorId: string;
  serviceId: string;
  clinicPatientId: string;
  startsAt: Date;
  notes: string | null;
  source: AppointmentSource;
  requestId: string;
  actor: Actor;
  /** Reserva un horario apartado para esta oferta de la lista de espera. */
  waitlistOfferId?: string;
  /** Cita atendida de la que esta es subsecuente. */
  followUpOfId?: string | null;
  /** Canal de una reserva en línea (web, widget, google, instagram). No forma parte del reintento idempotente. */
  channel?: string | null;
  /** Videoconsulta (sólo en servicios que la ofrecen). */
  modality?: 'IN_PERSON' | 'VIDEO';
}

const HELD = 'Ese horario está apartado para una persona de la lista de espera.';

@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly reminders: RemindersService,
    private readonly jobs: JobsService,
    private readonly reviews: ReviewsService,
  ) {}

  /** Horarios apartados vigentes de la lista de espera que se traslapan con el rango. */
  async holds(tx: Tx | PrismaService, doctorId: string, start: Date, end: Date, excludeOfferId: string | null = null) {
    const rows = await tx.waitlistOffer.findMany({
      where: {
        doctorId, status: 'PENDING', expiresAt: { gt: new Date() }, startsAt: { lt: end }, endsAt: { gt: start },
        ...(excludeOfferId ? { id: { not: excludeOfferId } } : {}),
      },
      select: { startsAt: true, endsAt: true },
    });
    return rows.map((r) => ({ start: r.startsAt, end: r.endsAt }));
  }

  /**
   * Citas vigentes de otros médicos en los consultorios que usa este médico: ocupan ese consultorio
   * aunque el médico esté libre.
   */
  async roomBusy(
    tx: Tx | PrismaService, rules: { roomId: string | null }[], doctorId: string, start: Date, end: Date,
    excludeAppointmentId: string | null = null,
  ): Promise<Map<string, Interval[]>> {
    const rooms = [...new Set(rules.map((r) => r.roomId).filter((r): r is string => Boolean(r)))];
    const map = new Map<string, Interval[]>();
    if (!rooms.length) return map;
    const rows = await tx.appointment.findMany({
      where: {
        roomId: { in: rooms }, doctorId: { not: doctorId }, status: { not: 'CANCELLED' },
        startsAt: { lt: end }, endsAt: { gt: start },
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      },
      select: { roomId: true, startsAt: true, endsAt: true },
    });
    for (const r of rows) map.set(r.roomId!, [...(map.get(r.roomId!) ?? []), { start: r.startsAt, end: r.endsAt }]);
    return map;
  }

  /** Avisa a la lista de espera que se liberó un horario (en la transacción que lo libera). */
  private async freed(tx: Tx, appointment: { id: string; doctorId: string; startsAt: Date; endsAt: Date }) {
    if (appointment.startsAt <= new Date()) return;
    await this.jobs.enqueue(tx, {
      type: WAITLIST_OFFER_JOB,
      payload: { doctorId: appointment.doctorId, startsAt: appointment.startsAt.toISOString(), endsAt: appointment.endsAt.toISOString() },
      dedupeKey: `waitlist-freed:${appointment.id}:${appointment.startsAt.toISOString()}`,
    });
  }

  /** Horarios disponibles para un médico y servicio. */
  async availability(params: {
    clinicId: string; doctorId: string; serviceId: string; from: string; days: number;
    excludeAppointmentId?: string; durationMinutes?: number; now?: Date; locationId?: string;
  }) {
    const clinic = await this.prisma.clinic.findUniqueOrThrow({ where: { id: params.clinicId } });
    const { doctor, service } = await this.loadDoctorService(this.prisma, params.clinicId, params.doctorId, params.serviceId);
    const days = Math.min(Math.max(params.days, 1), MAX_AVAILABILITY_DAYS);
    const first = parseLocalDate(params.from, clinic.timezone);
    if (!first) throw new BadRequestException('Fecha inválida');
    const rangeStart = first.toJSDate();
    const rangeEnd = first.plus({ days }).toJSDate();
    const now = params.now ?? new Date();
    const [rules, appointments, timeOffs] = await Promise.all([
      this.prisma.scheduleRule.findMany({ where: { doctorId: doctor.id } }),
      this.prisma.appointment.findMany({
        where: {
          doctorId: doctor.id, status: { not: 'CANCELLED' },
          startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart },
          ...(params.excludeAppointmentId ? { id: { not: params.excludeAppointmentId } } : {}),
        },
        select: { startsAt: true, endsAt: true },
      }),
      this.prisma.timeOff.findMany({
        where: { doctorId: doctor.id, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } },
        select: { startsAt: true, endsAt: true },
      }),
    ]);
    const busy = [
      ...appointments.map((a) => ({ start: a.startsAt, end: a.endsAt })),
      ...timeOffs.map((t) => ({ start: t.startsAt, end: t.endsAt })),
      ...(await this.holds(this.prisma, doctor.id, rangeStart, rangeEnd)),
    ];
    const days_ = computeSlots({
      timezone: clinic.timezone,
      rules,
      durationMinutes: params.durationMinutes ?? service.durationMinutes,
      busy,
      roomBusy: await this.roomBusy(this.prisma, rules, doctor.id, rangeStart, rangeEnd, params.excludeAppointmentId ?? null),
      locationId: params.locationId,
      fromDate: first.toISODate()!,
      days,
      earliest: new Date(now.getTime() + clinic.minNoticeMinutes * 60_000),
      latest: DateTime.fromJSDate(now).plus({ days: clinic.horizonDays }).toJSDate(),
    });
    const locationIds = [...new Set(rules.map((r) => r.locationId))];
    return {
      timezone: clinic.timezone,
      doctor: { id: doctor.id, displayName: doctor.displayName },
      service: {
        id: service.id, name: service.name, durationMinutes: service.durationMinutes, priceCents: service.priceCents,
        visitType: service.visitType,
        /** Precio en cada sede donde atiende el médico. */
        priceByLocation: await pricesFor(this.prisma, service, doctor.id, locationIds),
      },
      days: days_,
    };
  }

  /** Crea una cita. Reintentos con el mismo requestId y cuerpo devuelven la misma cita. */
  async book(input: BookingInput): Promise<{ appointment: Appointment; replayed: boolean }> {
    const requestKey = `${input.actor.kind}:${input.actor.id}:${input.requestId}`;
    const requestHash = canonicalHash({
      clinicId: input.clinicId, doctorId: input.doctorId, serviceId: input.serviceId,
      clinicPatientId: input.clinicPatientId, startsAt: input.startsAt.toISOString(), notes: input.notes,
      waitlistOfferId: input.waitlistOfferId, followUpOfId: input.followUpOfId ?? undefined,
      modality: input.modality === 'VIDEO' ? 'VIDEO' : undefined,
    });
    const replay = async () => {
      const existing = await this.prisma.appointment.findUnique({ where: { requestKey } });
      if (!existing) return null;
      if (existing.requestHash !== requestHash) {
        throw new ConflictException('Esa referencia de envío ya se usó con otros datos');
      }
      return { appointment: existing, replayed: true };
    };
    const previous = await replay();
    if (previous) return previous;

    if (input.startsAt.getUTCSeconds() !== 0 || input.startsAt.getUTCMilliseconds() !== 0) {
      throw new BadRequestException('La hora debe estar en minutos exactos');
    }

    try {
      const appointment = await this.prisma.$transaction(async (tx) => {
        const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: input.clinicId } });
        const { doctor, service } = await this.loadDoctorService(tx, input.clinicId, input.doctorId, input.serviceId);
        await lockDoctor(tx, doctor.id);
        const now = new Date();
        const startsAt = input.startsAt;
        const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
        const offer = input.waitlistOfferId ? await this.lockOffer(tx, input, endsAt, now) : null;
        if (input.modality === 'VIDEO' && !service.telemedicine) {
          throw new BadRequestException('Este servicio no se ofrece por videoconsulta');
        }

        if (input.source === 'ONLINE') {
          if (!canBookOnline(clinic)) throw new ForbiddenException('La clínica no acepta reservas en línea por ahora');
          await this.assertOnlineSlot(tx, clinic, doctor.id, service.durationMinutes, startsAt, now, null, offer?.id ?? null);
          const future = await tx.appointment.count({
            where: { clinicPatientId: input.clinicPatientId, status: { in: [...ACTIVE_STATUSES] }, startsAt: { gt: now } },
          });
          if (future >= MAX_FUTURE_ONLINE_APPOINTMENTS) {
            throw new ConflictException(
              `Puedes tener hasta ${MAX_FUTURE_ONLINE_APPOINTMENTS} citas próximas en esta clínica.`,
            );
          }
          await this.assertVisitType(tx, service.visitType, input.clinicPatientId, doctor.id);
        } else {
          await this.assertStaffSlot(tx, clinic.timezone, doctor.id, service.durationMinutes, startsAt, now, offer?.id ?? null, null);
        }
        // La sede y el consultorio son los del bloque del horario donde cae la cita.
        const rule = ruleAt(startsAt, service.durationMinutes, clinic.timezone, await tx.scheduleRule.findMany({ where: { doctorId: doctor.id } }));
        if (!rule) throw new ConflictException('Ese horario está fuera del horario de atención del médico');

        const patientOverlap = await tx.appointment.count({
          where: {
            clinicPatientId: input.clinicPatientId, status: { in: [...ACTIVE_STATUSES] },
            startsAt: { lt: endsAt }, endsAt: { gt: startsAt },
          },
        });
        if (patientOverlap > 0) throw new ConflictException('El paciente ya tiene una cita en ese horario');

        const priceCents = await resolvePrice(tx, service, doctor.id, rule.locationId);
        // Pago obligatorio: la reserva en línea aparta el horario hasta que se pague (o vence y se libera).
        const pending = input.source === 'ONLINE' && !offer && requiresPayment(this.config.payments !== null, clinic, priceCents);
        const paymentDueAt = pending ? new Date(now.getTime() + PAYMENT_HOLD_MINUTES * 60_000) : null;
        const created = await tx.appointment.create({
          data: {
            clinicId: input.clinicId, doctorId: doctor.id, serviceId: service.id,
            clinicPatientId: input.clinicPatientId, startsAt, endsAt, source: input.source,
            serviceName: service.name, durationMinutes: service.durationMinutes,
            priceCents, status: pending ? 'PENDING_PAYMENT' : 'BOOKED', paymentDueAt, modality: input.modality ?? 'IN_PERSON',
            patientNotes: input.notes, requestKey, requestHash, followUpOfId: input.followUpOfId ?? null,
            locationId: rule.locationId, roomId: rule.roomId, channel: input.channel ?? null,
          },
        });
        if (offer) {
          await tx.waitlistOffer.update({ where: { id: offer.id }, data: { status: 'ACCEPTED', appointmentId: created.id } });
          await tx.waitlistEntry.update({ where: { id: offer.entryId }, data: { status: 'BOOKED', appointmentId: created.id } });
        }
        const event = await tx.appointmentEvent.create({
          data: {
            appointmentId: created.id, type: 'CREATED', actorKind: input.actor.kind,
            actorId: input.actor.id, actorName: input.actor.name, toStartsAt: startsAt,
          },
        });
        if (pending) {
          // La confirmación y los recordatorios salen cuando llega el pago.
          await this.enqueueExpiry(tx, created.id, paymentDueAt!);
        } else {
          await this.mail.appointmentEvent(tx, event.id);
          await this.reminders.schedule(tx, created, clinic, now);
        }
        return created;
      });
      return { appointment, replayed: false };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await replay();
        if (again) return again;
      }
      if (isDoubleBooking(e)) throw new ConflictException(SLOT_TAKEN);
      throw e;
    }
  }

  /** Cancela una cita vigente. Repetir la cancelación devuelve la cita sin cambios. */
  async cancel(params: {
    appointment: Appointment; reason: string; actor: Actor; minMinutesBefore: number | null;
  }): Promise<Appointment> {
    const { appointment, actor } = params;
    return this.prisma.$transaction(async (tx) => {
      await lockDoctor(tx, appointment.doctorId);
      const current = await tx.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
      if (current.status === 'CANCELLED') return current;
      if (current.status !== 'BOOKED' && current.status !== 'PENDING_PAYMENT') {
        throw new ConflictException('La cita ya fue atendida o marcada como no asistió');
      }
      const now = new Date();
      if (current.startsAt <= now) throw new ConflictException('La cita ya comenzó');
      if (params.minMinutesBefore !== null && current.startsAt.getTime() - now.getTime() < params.minMinutesBefore * 60_000) {
        throw new ConflictException('Ya no es posible cancelar en línea. Comunícate con la clínica.');
      }
      const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: current.clinicId } });
      return this.cancelLocked(tx, clinic, current, params.reason, actor, now);
    });
  }

  /** Cancela con el médico ya bloqueado: reembolso según la política, aviso por correo y horario liberado. */
  private async cancelLocked(
    tx: Tx, clinic: Prisma.ClinicGetPayload<object>, current: Appointment, reason: string, actor: Actor, now: Date,
  ): Promise<Appointment> {
    const updated = await tx.appointment.update({
      where: { id: current.id }, data: { status: 'CANCELLED', cancelReason: reason, paymentDueAt: null },
    });
    await settleOnCancel(tx, this.jobs, clinic, current, actor, now);
    const event = await tx.appointmentEvent.create({
      data: {
        appointmentId: current.id, type: 'CANCELLED', actorKind: actor.kind, actorId: actor.id,
        actorName: actor.name, reason, fromStartsAt: current.startsAt,
      },
    });
    await this.mail.appointmentEvent(tx, event.id);
    await this.freed(tx, current);
    return updated;
  }

  /** Programa (o reprograma, si el plazo cambió) la cancelación de una cita que no se pague a tiempo. */
  async enqueueExpiry(tx: Tx, appointmentId: string, dueAt: Date) {
    await this.jobs.enqueue(tx, {
      type: PAYMENT_EXPIRE_JOB, payload: { appointmentId },
      runAt: new Date(dueAt.getTime() + 60_000), dedupeKey: `payment-expire:${appointmentId}:${dueAt.getTime()}`,
    });
  }

  /** Vence el apartado: si la cita sigue sin pagar y pasó su plazo, se cancela y el horario se libera. */
  async expireUnpaid(appointmentId: string, now = new Date()): Promise<Appointment | null> {
    const a = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!a) return null;
    return this.prisma.$transaction(async (tx) => {
      await lockDoctor(tx, a.doctorId);
      const current = await tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
      if (current.status !== 'PENDING_PAYMENT' || !current.paymentDueAt || current.paymentDueAt > now) return null;
      const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: current.clinicId } });
      return this.cancelLocked(tx, clinic, current, 'No se recibió el pago a tiempo', SYSTEM_ACTOR, now);
    });
  }

  /** Llegó el pago: la cita apartada queda agendada (confirmación por correo y recordatorios). */
  async confirmPaid(tx: Tx, appointment: Appointment, amountCents: number, now: Date) {
    const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: appointment.clinicId } });
    const updated = appointment.status === 'PENDING_PAYMENT'
      ? await tx.appointment.update({ where: { id: appointment.id }, data: { status: 'BOOKED', paymentDueAt: null } })
      : appointment;
    const event = await tx.appointmentEvent.create({
      data: {
        appointmentId: appointment.id, type: 'PAID', actorKind: SYSTEM_ACTOR.kind, actorId: SYSTEM_ACTOR.id,
        actorName: SYSTEM_ACTOR.name, reason: `Pago en línea de ${(amountCents / 100).toFixed(2)} MXN`, toStartsAt: appointment.startsAt,
      },
    });
    await this.mail.appointmentEvent(tx, event.id);
    if (appointment.status === 'PENDING_PAYMENT') await this.reminders.schedule(tx, updated, clinic, now);
    return updated;
  }

  /**
   * Reprograma una cita. expectedStartsAt detecta cambios concurrentes; si la cita
   * ya está en el horario solicitado se devuelve sin cambios (reintento).
   */
  async reschedule(params: {
    appointment: Appointment; startsAt: Date; expectedStartsAt: Date; actor: Actor; online: boolean;
  }): Promise<Appointment> {
    const { actor } = params;
    if (params.startsAt.getUTCSeconds() !== 0 || params.startsAt.getUTCMilliseconds() !== 0) {
      throw new BadRequestException('La hora debe estar en minutos exactos');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockDoctor(tx, params.appointment.doctorId);
        const current = await tx.appointment.findUniqueOrThrow({ where: { id: params.appointment.id } });
        if (current.status !== 'BOOKED') throw new ConflictException('Sólo se pueden reprogramar citas vigentes');
        if (current.startsAt.getTime() === params.startsAt.getTime()) return current;
        if (current.startsAt.getTime() !== params.expectedStartsAt.getTime()) {
          throw new ConflictException('La cita cambió mientras tanto. Actualiza e inténtalo de nuevo.');
        }
        const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: current.clinicId } });
        const now = new Date();
        if (current.startsAt <= now) throw new ConflictException('La cita ya comenzó');
        if (params.online) {
          if (!canBookOnline(clinic)) throw new ForbiddenException('La clínica no acepta cambios en línea por ahora');
          if (current.startsAt.getTime() - now.getTime() < clinic.patientCancelMinMinutes * 60_000) {
            throw new ConflictException('Ya no es posible reprogramar en línea. Comunícate con la clínica.');
          }
          await this.assertOnlineSlot(tx, clinic, current.doctorId, current.durationMinutes, params.startsAt, now, current.id, null);
        } else {
          await this.assertStaffSlot(tx, clinic.timezone, current.doctorId, current.durationMinutes, params.startsAt, now, null, current.id);
        }
        const rule = ruleAt(params.startsAt, current.durationMinutes, clinic.timezone, await tx.scheduleRule.findMany({ where: { doctorId: current.doctorId } }));
        if (!rule) throw new ConflictException('Ese horario está fuera del horario de atención del médico');
        const endsAt = new Date(params.startsAt.getTime() + current.durationMinutes * 60_000);
        const patientOverlap = await tx.appointment.count({
          where: {
            clinicPatientId: current.clinicPatientId, status: { in: [...ACTIVE_STATUSES] }, id: { not: current.id },
            startsAt: { lt: endsAt }, endsAt: { gt: params.startsAt },
          },
        });
        if (patientOverlap > 0) throw new ConflictException('El paciente ya tiene otra cita en ese horario');
        // Una confirmación previa era para el horario anterior.
        const updated = await tx.appointment.update({
          where: { id: current.id },
          data: { startsAt: params.startsAt, endsAt, confirmedAt: null, locationId: rule.locationId, roomId: rule.roomId },
        });
        const event = await tx.appointmentEvent.create({
          data: {
            appointmentId: current.id, type: 'RESCHEDULED', actorKind: actor.kind, actorId: actor.id,
            actorName: actor.name, fromStartsAt: current.startsAt, toStartsAt: params.startsAt,
          },
        });
        await this.mail.appointmentEvent(tx, event.id);
        await this.reminders.schedule(tx, updated, clinic, now);
        await this.freed(tx, current);
        return updated;
      });
    } catch (e) {
      if (isDoubleBooking(e)) throw new ConflictException(SLOT_TAKEN);
      throw e;
    }
  }

  /** El paciente confirma su asistencia. Repetir la confirmación no cambia nada. */
  async confirm(params: { appointment: Appointment; actor: Actor }): Promise<Appointment> {
    return this.prisma.$transaction(async (tx) => {
      await lockDoctor(tx, params.appointment.doctorId);
      const current = await tx.appointment.findUniqueOrThrow({ where: { id: params.appointment.id } });
      if (current.status !== 'BOOKED') throw new ConflictException('La cita ya no está vigente');
      if (current.startsAt <= new Date()) throw new ConflictException('La cita ya comenzó');
      if (current.confirmedAt) return current;
      const updated = await tx.appointment.update({ where: { id: current.id }, data: { confirmedAt: new Date() } });
      await tx.appointmentEvent.create({
        data: {
          appointmentId: current.id, type: 'CONFIRMED', actorKind: params.actor.kind,
          actorId: params.actor.id, actorName: params.actor.name,
        },
      });
      return updated;
    });
  }

  /** Marca una cita como atendida o no asistió (sólo después de su hora de inicio). */
  async markOutcome(params: {
    appointment: Appointment; status: 'COMPLETED' | 'NO_SHOW'; expectedStatus: string; actor: Actor;
  }): Promise<Appointment> {
    return this.prisma.$transaction(async (tx) => {
      await lockDoctor(tx, params.appointment.doctorId);
      const current = await tx.appointment.findUniqueOrThrow({ where: { id: params.appointment.id } });
      if (current.status === params.status) return current;
      if (current.status !== params.expectedStatus || current.status !== 'BOOKED') {
        throw new ConflictException('La cita cambió mientras tanto. Actualiza e inténtalo de nuevo.');
      }
      if (current.startsAt > new Date()) {
        throw new ConflictException('Sólo puedes registrar asistencia cuando la cita ya comenzó');
      }
      const updated = await tx.appointment.update({ where: { id: current.id }, data: { status: params.status } });
      if (params.status === 'COMPLETED') {
        const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: current.clinicId } });
        await this.reviews.scheduleInvite(tx, updated, clinic);
      }
      await tx.appointmentEvent.create({
        data: {
          appointmentId: current.id, type: params.status, actorKind: params.actor.kind,
          actorId: params.actor.id, actorName: params.actor.name,
        },
      });
      return updated;
    });
  }

  private async loadDoctorService(tx: Tx | PrismaService, clinicId: string, doctorId: string, serviceId: string) {
    const doctor = await tx.doctor.findFirst({ where: { id: doctorId, clinicId, active: true } });
    if (!doctor) throw new NotFoundException('Médico no disponible');
    const service = await tx.service.findFirst({
      where: { id: serviceId, clinicId, active: true, doctors: { some: { doctorId } } },
    });
    if (!service) throw new NotFoundException('Servicio no disponible con este médico');
    return { doctor, service };
  }

  /** El horario solicitado debe coincidir exactamente con un horario disponible publicado. */
  private async assertOnlineSlot(
    tx: Tx,
    clinic: { timezone: string; minNoticeMinutes: number; horizonDays: number },
    doctorId: string, durationMinutes: number, startsAt: Date, now: Date, excludeId: string | null,
    excludeOfferId: string | null,
  ) {
    if (!(await this.onlineSlotFree(tx, clinic, doctorId, durationMinutes, startsAt, now, excludeId, excludeOfferId))) {
      throw new ConflictException(SLOT_TAKEN);
    }
  }

  /** ¿El horario es uno de los publicados y está libre (citas, bloqueos y apartados)? */
  async onlineSlotFree(
    tx: Tx,
    clinic: { timezone: string; minNoticeMinutes: number; horizonDays: number },
    doctorId: string, durationMinutes: number, startsAt: Date, now: Date, excludeId: string | null,
    excludeOfferId: string | null,
  ): Promise<boolean> {
    const day = DateTime.fromJSDate(startsAt, { zone: clinic.timezone }).startOf('day');
    const dayStart = day.toJSDate();
    const dayEnd = day.plus({ days: 1 }).toJSDate();
    const [rules, appointments, timeOffs] = await Promise.all([
      tx.scheduleRule.findMany({ where: { doctorId } }),
      tx.appointment.findMany({
        where: {
          doctorId, status: { not: 'CANCELLED' }, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart },
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { startsAt: true, endsAt: true },
      }),
      tx.timeOff.findMany({
        where: { doctorId, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
        select: { startsAt: true, endsAt: true },
      }),
    ]);
    const [slotsDay] = computeSlots({
      timezone: clinic.timezone, rules, durationMinutes,
      busy: [
        ...[...appointments, ...timeOffs].map((b) => ({ start: b.startsAt, end: b.endsAt })),
        ...(await this.holds(tx, doctorId, dayStart, dayEnd, excludeOfferId)),
      ],
      roomBusy: await this.roomBusy(tx, rules, doctorId, dayStart, dayEnd, excludeId),
      fromDate: day.toISODate()!, days: 1,
      earliest: new Date(now.getTime() + clinic.minNoticeMinutes * 60_000),
      latest: DateTime.fromJSDate(now).plus({ days: clinic.horizonDays }).toJSDate(),
    });
    const wanted = startsAt.getTime();
    return Boolean(slotsDay?.slots.some((s) => new Date(s.startsAt).getTime() === wanted));
  }

  /** Personal: dentro del horario del médico, sin bloqueos y en el futuro. */
  private async assertStaffSlot(
    tx: Tx, timezone: string, doctorId: string, durationMinutes: number, startsAt: Date, now: Date,
    excludeOfferId: string | null, excludeAppointmentId: string | null,
  ) {
    if (startsAt <= now) throw new BadRequestException('La cita debe ser en el futuro');
    if (startsAt.getTime() - now.getTime() > 400 * 24 * 3600_000) {
      throw new BadRequestException('La cita está demasiado lejos en el futuro');
    }
    const local = DateTime.fromJSDate(startsAt, { zone: timezone });
    if (local.minute % 5 !== 0) throw new BadRequestException('La hora debe ir en múltiplos de 5 minutos');
    const rules = await tx.scheduleRule.findMany({ where: { doctorId }, include: { room: { select: { name: true } } } });
    const rule = ruleAt(startsAt, durationMinutes, timezone, rules);
    if (!rule) throw new ConflictException('Ese horario está fuera del horario de atención del médico');
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    if (rule.roomId) {
      const roomTaken = await tx.appointment.count({
        where: {
          roomId: rule.roomId, status: { not: 'CANCELLED' }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt },
          doctorId: { not: doctorId }, ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
        },
      });
      if (roomTaken > 0) throw new ConflictException(`El consultorio «${rule.room?.name}» está ocupado a esa hora`);
    }
    const blocked = await tx.timeOff.count({
      where: { doctorId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    });
    if (blocked > 0) throw new ConflictException('El médico tiene un bloqueo en ese horario');
    if ((await this.holds(tx, doctorId, startsAt, endsAt, excludeOfferId)).length > 0) throw new ConflictException(HELD);
  }

  /** Servicios sólo de primera vez o sólo subsecuentes (según citas atendidas con ese médico). */
  private async assertVisitType(tx: Tx, visitType: string, clinicPatientId: string, doctorId: string) {
    if (visitType === 'ANY') return;
    const seen = await tx.appointment.count({ where: { clinicPatientId, doctorId, status: 'COMPLETED' } });
    if (visitType === 'FIRST' && seen > 0) {
      throw new ConflictException('Este servicio es sólo para primera vez. Elige la consulta subsecuente.');
    }
    if (visitType === 'FOLLOW_UP' && seen === 0) {
      throw new ConflictException('Este servicio es para pacientes que ya fueron atendidos por este médico.');
    }
  }

  /** Valida la oferta de la lista de espera que se está aceptando (bloqueada hasta el final de la transacción). */
  private async lockOffer(tx: Tx, input: BookingInput, endsAt: Date, now: Date) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "WaitlistOffer" WHERE id = ${input.waitlistOfferId}::uuid FOR UPDATE`;
    const offer = rows.length
      ? await tx.waitlistOffer.findUnique({ where: { id: rows[0].id }, include: { entry: true } })
      : null;
    if (
      !offer || offer.status !== 'PENDING' || offer.expiresAt <= now || offer.clinicId !== input.clinicId ||
      offer.doctorId !== input.doctorId || offer.entry.serviceId !== input.serviceId ||
      offer.entry.clinicPatientId !== input.clinicPatientId || offer.startsAt.getTime() !== input.startsAt.getTime() ||
      offer.endsAt.getTime() !== endsAt.getTime()
    ) {
      throw new ConflictException('El horario apartado ya no está disponible');
    }
    return offer;
  }
}
