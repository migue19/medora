import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService, Tx } from '../prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { MailService } from '../mail/mail.service';
import { randomToken, sha256 } from '../common/crypto';
import {
  Actor, AppointmentsService, MAX_FUTURE_ONLINE_APPOINTMENTS, WAITLIST_OFFER_JOB, lockDoctor,
} from '../appointments/appointments.service';

export const WAITLIST_EXPIRE_JOB = 'waitlist.expire';
/** Tiempo que se aparta un horario a una persona de la lista. */
export const OFFER_TTL_MS = 2 * 60 * 60_000;
/** No se ofrece un horario que empieza en menos de esto, ni se aparta más allá de este margen antes. */
const MIN_LEAD_MS = 45 * 60_000;
const CLOSE_BEFORE_MS = 30 * 60_000;
export const MAX_WAITING_PER_PATIENT = 3;

interface FreedPayload { doctorId: string; startsAt: string; endsAt: string }

export interface NewEntry {
  clinicId: string;
  doctorId: string;
  serviceId: string;
  clinicPatientId: string;
  fromDate?: string | null;
  toDate?: string | null;
  notes?: string | null;
  actor: Actor;
}

/**
 * Lista de espera por médico y servicio. Cuando se libera un horario (cancelación o reprogramación),
 * se aparta a la primera persona compatible y se le avisa; si rechaza o no responde a tiempo, pasa
 * a la siguiente. Un apartado PENDING vigente bloquea el horario para cualquier otra reserva.
 */
@Injectable()
export class WaitlistService implements OnModuleInit {
  private readonly logger = new Logger('ListaDeEspera');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
    private readonly appointments: AppointmentsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register(WAITLIST_OFFER_JOB, async (p) => { await this.offerFreed(p as unknown as FreedPayload); });
    this.jobs.register(WAITLIST_EXPIRE_JOB, (p) => this.expire((p as { offerId: string }).offerId));
  }

  async add(input: NewEntry) {
    for (const d of [input.fromDate, input.toDate]) {
      if (d && !DateTime.fromISO(d).isValid) throw new BadRequestException('Fecha inválida');
    }
    if (input.fromDate && input.toDate && input.fromDate > input.toDate) {
      throw new BadRequestException('La fecha inicial debe ser anterior a la final');
    }
    const service = await this.prisma.service.findFirst({
      where: {
        id: input.serviceId, clinicId: input.clinicId, active: true,
        doctors: { some: { doctorId: input.doctorId, doctor: { active: true } } },
      },
    });
    if (!service) throw new NotFoundException('Ese médico no ofrece ese servicio');
    const waiting = await this.prisma.waitlistEntry.count({
      where: { clinicPatientId: input.clinicPatientId, status: 'WAITING' },
    });
    if (waiting >= MAX_WAITING_PER_PATIENT) {
      throw new ConflictException(`Puedes estar en hasta ${MAX_WAITING_PER_PATIENT} listas de espera a la vez`);
    }
    try {
      return await this.prisma.waitlistEntry.create({
        data: {
          clinicId: input.clinicId, doctorId: input.doctorId, serviceId: input.serviceId,
          clinicPatientId: input.clinicPatientId, fromDate: input.fromDate ?? null, toDate: input.toDate ?? null,
          notes: input.notes ?? null, createdByKind: input.actor.kind, createdById: input.actor.id,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya está en la lista de espera de ese médico y servicio');
      }
      throw e;
    }
  }

  /** Sale de la lista. Si tenía un horario apartado, se libera para la siguiente persona. */
  async remove(clinicId: string, entryId: string, clinicPatientId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const entry = await tx.waitlistEntry.findFirst({
        where: { id: entryId, clinicId, status: 'WAITING', ...(clinicPatientId ? { clinicPatientId } : {}) },
      });
      if (!entry) throw new NotFoundException('No está en la lista de espera');
      await lockDoctor(tx, entry.doctorId);
      await tx.waitlistEntry.update({ where: { id: entry.id }, data: { status: 'REMOVED' } });
      const pending = await tx.waitlistOffer.findFirst({ where: { entryId: entry.id, status: 'PENDING' } });
      if (pending) await this.closeOffer(tx, pending.id, 'RELEASED');
    });
  }

  /** Cierra una oferta pendiente y vuelve a ofrecer su horario a la lista. */
  private async closeOffer(tx: Tx, offerId: string, status: 'DECLINED' | 'EXPIRED' | 'RELEASED') {
    const offer = await tx.waitlistOffer.update({ where: { id: offerId }, data: { status } });
    await this.jobs.enqueue(tx, {
      type: WAITLIST_OFFER_JOB,
      payload: { doctorId: offer.doctorId, startsAt: offer.startsAt.toISOString(), endsAt: offer.endsAt.toISOString() },
      dedupeKey: `waitlist-reoffer:${offer.id}`,
    });
  }

  /** Ofrece un horario liberado a la primera persona compatible de la lista del médico. */
  async offerFreed(p: FreedPayload, now = new Date()): Promise<string | null> {
    const startsAt = new Date(p.startsAt);
    if (startsAt.getTime() - now.getTime() < MIN_LEAD_MS) return null;
    return this.prisma.$transaction(async (tx) => {
      await lockDoctor(tx, p.doctorId);
      // Apartados vencidos que el trabajo de vencimiento todavía no procesó.
      const stale = await tx.waitlistOffer.findMany({
        where: { doctorId: p.doctorId, status: 'PENDING', expiresAt: { lte: now } }, select: { id: true },
      });
      for (const s of stale) await this.closeOffer(tx, s.id, 'EXPIRED');

      const candidates = await tx.waitlistEntry.findMany({
        where: {
          doctorId: p.doctorId, status: 'WAITING',
          offers: { none: { OR: [{ status: 'PENDING' }, { startsAt }] } },
          clinicPatient: { mergedIntoId: null },
        },
        include: { clinicPatient: true },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      if (!candidates.length) return null;
      const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: candidates[0].clinicId } });
      const localDate = DateTime.fromJSDate(startsAt, { zone: clinic.timezone }).toISODate()!;

      for (const entry of candidates) {
        if ((entry.fromDate && localDate < entry.fromDate) || (entry.toDate && localDate > entry.toDate)) continue;
        const service = await tx.service.findFirst({
          where: { id: entry.serviceId, active: true, doctors: { some: { doctorId: p.doctorId } } },
        });
        if (!service) continue;
        const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
        if (!(await this.appointments.onlineSlotFree(tx, clinic, p.doctorId, service.durationMinutes, startsAt, now, null, null))) {
          continue;
        }
        const [overlap, future] = await Promise.all([
          tx.appointment.count({
            where: { clinicPatientId: entry.clinicPatientId, status: 'BOOKED', startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
          }),
          tx.appointment.count({ where: { clinicPatientId: entry.clinicPatientId, status: 'BOOKED', startsAt: { gt: now } } }),
        ]);
        if (overlap > 0 || future >= MAX_FUTURE_ONLINE_APPOINTMENTS) continue;

        const expiresAt = new Date(Math.min(now.getTime() + OFFER_TTL_MS, startsAt.getTime() - CLOSE_BEFORE_MS));
        const token = randomToken();
        const offer = await tx.waitlistOffer.create({
          data: {
            clinicId: clinic.id, entryId: entry.id, doctorId: p.doctorId, startsAt, endsAt, expiresAt,
            tokenHash: sha256(token),
          },
        });
        await this.jobs.enqueue(tx, {
          type: WAITLIST_EXPIRE_JOB, payload: { offerId: offer.id }, runAt: expiresAt,
          dedupeKey: `waitlist-expire:${offer.id}`,
        });
        if (entry.clinicPatient.email) {
          const doctor = await tx.doctor.findUniqueOrThrow({ where: { id: p.doctorId } });
          await this.mail.waitlistOffer(tx, {
            email: entry.clinicPatient.email, token, patientName: entry.clinicPatient.name,
            clinic: { name: clinic.name, address: clinic.address, phone: clinic.phone, timezone: clinic.timezone },
            doctorName: doctor.displayName, serviceName: service.name, startsAt, expiresAt,
          });
        }
        this.logger.log(`Horario ${startsAt.toISOString()} apartado para la entrada ${entry.id}`);
        return offer.id;
      }
      return null;
    });
  }

  /** Vence un apartado sin respuesta y ofrece el horario a la siguiente persona. */
  async expire(offerId: string, now = new Date()) {
    await this.prisma.$transaction(async (tx) => {
      const offer = await tx.waitlistOffer.findUnique({ where: { id: offerId } });
      if (!offer || offer.status !== 'PENDING' || offer.expiresAt > now) return;
      await lockDoctor(tx, offer.doctorId);
      await this.closeOffer(tx, offer.id, 'EXPIRED');
    });
  }

  async findOfferByToken(token: string) {
    const offer = await this.prisma.waitlistOffer.findUnique({
      where: { tokenHash: sha256(token) },
      include: {
        entry: {
          include: { clinicPatient: { select: { id: true, name: true, patientAccountId: true } } },
        },
      },
    });
    if (!offer) throw new BadRequestException('El enlace no es válido.');
    return offer;
  }

  async inspect(token: string) {
    const offer = await this.findOfferByToken(token);
    const [clinic, doctor, service] = await Promise.all([
      this.prisma.clinic.findUniqueOrThrow({ where: { id: offer.clinicId } }),
      this.prisma.doctor.findUniqueOrThrow({ where: { id: offer.doctorId } }),
      this.prisma.service.findUniqueOrThrow({ where: { id: offer.entry.serviceId } }),
    ]);
    const open = offer.status === 'PENDING' && offer.expiresAt > new Date();
    return {
      clinic: { name: clinic.name, address: clinic.address, phone: clinic.phone, timezone: clinic.timezone },
      doctor: { displayName: doctor.displayName, specialty: doctor.specialty },
      service: { name: service.name, durationMinutes: service.durationMinutes, priceCents: service.priceCents },
      patientName: offer.entry.clinicPatient.name,
      startsAt: offer.startsAt, expiresAt: offer.expiresAt,
      status: open || offer.status !== 'PENDING' ? offer.status : 'EXPIRED',
      open,
    };
  }

  /** Acepta el horario apartado: crea la cita y saca a la persona de la lista. */
  async accept(offerId: string, actor: Actor, source: 'ONLINE' | 'STAFF', clinicId?: string) {
    const offer = await this.prisma.waitlistOffer.findUnique({ where: { id: offerId }, include: { entry: true } });
    if (!offer || (clinicId && offer.clinicId !== clinicId)) throw new NotFoundException('Oferta no encontrada');
    if (offer.status === 'ACCEPTED' && offer.appointmentId) {
      return this.prisma.appointment.findUniqueOrThrow({ where: { id: offer.appointmentId } });
    }
    try {
      const { appointment } = await this.appointments.book({
        clinicId: offer.clinicId, doctorId: offer.doctorId, serviceId: offer.entry.serviceId,
        clinicPatientId: offer.entry.clinicPatientId, startsAt: offer.startsAt, notes: offer.entry.notes,
        source, requestId: offer.id, actor, waitlistOfferId: offer.id,
      });
      return appointment;
    } catch (e) {
      // Doble clic: otra petición aceptó esta misma oferta mientras tanto.
      const current = await this.prisma.waitlistOffer.findUnique({ where: { id: offer.id } });
      if (current?.status === 'ACCEPTED' && current.appointmentId) {
        return this.prisma.appointment.findUniqueOrThrow({ where: { id: current.appointmentId } });
      }
      throw e;
    }
  }

  async decline(offerId: string) {
    await this.prisma.$transaction(async (tx) => {
      const offer = await tx.waitlistOffer.findUnique({ where: { id: offerId } });
      if (!offer || offer.status !== 'PENDING') throw new ConflictException('Esta oferta ya no está vigente');
      await lockDoctor(tx, offer.doctorId);
      await this.closeOffer(tx, offer.id, 'DECLINED');
    });
  }

  /** La clínica libera un apartado (p. ej. el paciente dijo por teléfono que no puede). */
  async release(clinicId: string, offerId: string) {
    await this.prisma.$transaction(async (tx) => {
      const offer = await tx.waitlistOffer.findFirst({ where: { id: offerId, clinicId } });
      if (!offer || offer.status !== 'PENDING') throw new ConflictException('Esta oferta ya no está vigente');
      await lockDoctor(tx, offer.doctorId);
      await this.closeOffer(tx, offer.id, 'RELEASED');
    });
  }

  /** Lista de la clínica: personas esperando, en orden, con su apartado vigente si lo tienen. */
  async list(clinicId: string, doctorId?: string) {
    const rows = await this.prisma.waitlistEntry.findMany({
      where: { clinicId, status: 'WAITING', ...(doctorId ? { doctorId } : {}) },
      orderBy: { createdAt: 'asc' },
      include: {
        clinicPatient: { select: { id: true, name: true, phone: true, email: true } },
        offers: { where: { status: 'PENDING' }, select: { id: true, startsAt: true, endsAt: true, expiresAt: true } },
      },
    });
    const now = new Date();
    return rows.map(({ offers, ...e }) => ({ ...e, offer: offers.find((o) => o.expiresAt > now) ?? null }));
  }
}
