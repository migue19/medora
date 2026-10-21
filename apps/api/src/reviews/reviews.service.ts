import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService, Tx } from '../prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { MailService } from '../mail/mail.service';
import { formatWhen } from '../mail/templates';
import { randomToken, sha256 } from '../common/crypto';
import { Actor } from '../appointments/appointments.service';
import { StaffContext } from '../auth/guards';
import { WHATSAPP_TRANSPORT, WhatsAppTransport, toWhatsAppNumber } from '../notifications/whatsapp.transport';

export const REVIEW_INVITE_JOB = 'review.invite';
/** La invitación sale dos horas después de terminar la cita. */
export const INVITE_DELAY_MS = 2 * 60 * 60_000;
export const INVITE_TTL_MS = 30 * 24 * 60 * 60_000;

/** Motivos de moderación: se muestran al paciente y quedan en la bitácora. */
export const HIDE_REASONS: Record<string, string> = {
  OFFENSIVE: 'Lenguaje ofensivo o discriminatorio',
  PERSONAL_DATA: 'Incluye datos personales o médicos de terceros',
  SPAM: 'Publicidad o contenido sin relación con la consulta',
  NOT_RELATED: 'No corresponde a la atención recibida',
  OTHER: 'Otro motivo',
};

export interface ReviewInput {
  ratingPunctuality: number;
  ratingTreatment: number;
  ratingFacilities: number;
  comment?: string | null;
  anonymous?: boolean;
}

/** «Ana María Pérez López» → «Ana P.»; anónimo → «Paciente verificado». */
export function publicAuthor(name: string, anonymous: boolean): string {
  if (anonymous) return 'Paciente verificado';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Paciente verificado';
  const first = parts[0];
  const last = parts.length > 1 ? ` ${parts[parts.length > 2 ? parts.length - 2 : 1][0].toUpperCase()}.` : '';
  return `${first}${last}`.slice(0, 60);
}

const average = (r: { ratingPunctuality: number; ratingTreatment: number; ratingFacilities: number }) =>
  Math.round(((r.ratingPunctuality + r.ratingTreatment + r.ratingFacilities) / 3) * 10) / 10;

export interface RatingSummary { count: number; average: number; punctuality: number; treatment: number; facilities: number }

/**
 * Opiniones verificadas. Sólo hay invitación (y opinión) para citas atendidas, una por cita; PostgreSQL lo
 * vuelve a comprobar con un disparador. La moderación oculta pero nunca borra, avisa al paciente y queda en
 * ReviewEvent junto con cada respuesta del médico.
 */
@Injectable()
export class ReviewsService implements OnModuleInit {
  private readonly logger = new Logger('Opiniones');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
    @Inject(WHATSAPP_TRANSPORT) private readonly whatsapp: WhatsAppTransport,
  ) {}

  onModuleInit(): void {
    this.jobs.register(REVIEW_INVITE_JOB, (p) => this.deliverInvite((p as { appointmentId: string }).appointmentId));
  }

  /** Se llama en la transacción que marca la cita como atendida. */
  async scheduleInvite(tx: Tx, appointment: { id: string; endsAt: Date }, clinic: { reviewsEnabled: boolean }) {
    if (!clinic.reviewsEnabled) return;
    const runAt = new Date(Math.max(Date.now(), appointment.endsAt.getTime()) + INVITE_DELAY_MS);
    await this.jobs.enqueue(tx, {
      type: REVIEW_INVITE_JOB, payload: { appointmentId: appointment.id }, runAt, dedupeKey: `review-invite:${appointment.id}`,
    });
  }

  async deliverInvite(appointmentId: string): Promise<void> {
    const a = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        clinic: true, review: { select: { id: true } }, doctor: { select: { displayName: true } },
        clinicPatient: { include: { patientAccount: { select: { whatsappConsentAt: true } } } },
      },
    });
    if (!a || a.status !== 'COMPLETED' || a.review || !a.clinic.reviewsEnabled) return;
    const email = a.clinicPatient.email;
    const consent = a.clinicPatient.patientAccount?.whatsappConsentAt ?? a.clinicPatient.whatsappConsentAt;
    const phone = consent && a.clinic.whatsappEnabled && this.whatsapp.configured && this.config.whatsapp
      ? toWhatsAppNumber(a.clinicPatient.phone, this.config.whatsapp.defaultCountryCode) : null;
    if (!email && !phone) return;
    const token = randomToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.reviewInvitation.create({
        data: { appointmentId: a.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      });
      if (email) {
        await this.mail.reviewInvitation(tx, {
          email, token, patientName: a.clinicPatient.name, clinicName: a.clinic.name, doctorName: a.doctor.displayName,
          when: formatWhen(a.startsAt, a.clinic.timezone),
        });
      }
    });
    if (phone) {
      try {
        await this.whatsapp.sendTemplate({
          to: phone, template: this.config.whatsapp!.reviewTemplate,
          bodyParams: [a.clinicPatient.name, a.doctor.displayName, a.clinic.name], buttonParam: token,
        });
      } catch (e) {
        // El correo ya salió; un fallo de WhatsApp no repite la invitación.
        this.logger.warn(`Invitación por WhatsApp de la cita ${a.id} falló: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  async inspectInvitation(token: string) {
    const inv = await this.validInvitation(this.prisma, token);
    const a = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: inv.appointmentId },
      include: { clinic: true, doctor: { select: { displayName: true, specialty: true } }, review: { select: { id: true } }, clinicPatient: { select: { name: true } } },
    });
    return {
      clinic: { name: a.clinic.name, timezone: a.clinic.timezone },
      doctor: a.doctor, serviceName: a.serviceName, startsAt: a.startsAt, patientName: a.clinicPatient.name,
      publicName: publicAuthor(a.clinicPatient.name, false),
      alreadyReviewed: a.review !== null,
    };
  }

  /** Publica la opinión con el enlace de la invitación (un solo uso). */
  async submitWithToken(token: string, input: ReviewInput) {
    return this.prisma.$transaction(async (tx) => {
      const inv = await this.validInvitation(tx, token);
      const claimed = await tx.reviewInvitation.updateMany({ where: { id: inv.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new BadRequestException(INVALID);
      const a = await tx.appointment.findUniqueOrThrow({ where: { id: inv.appointmentId }, include: { clinicPatient: true } });
      return this.create(tx, a, input, {
        kind: 'PATIENT', id: a.clinicPatient.patientAccountId ?? a.clinicPatient.id, name: a.clinicPatient.name,
      });
    });
  }

  /** Desde «Mis citas»: el paciente opina sobre su propia cita atendida. */
  async submitFromPortal(patientAccountId: string, appointmentId: string, input: ReviewInput) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.appointment.findFirst({
        where: { id: appointmentId, clinicPatient: { patientAccountId } }, include: { clinicPatient: true, clinic: true },
      });
      if (!a) throw new NotFoundException('Cita no encontrada');
      if (!a.clinic.reviewsEnabled) throw new ForbiddenException('Esta clínica no recibe opiniones');
      return this.create(tx, a, input, { kind: 'PATIENT', id: patientAccountId, name: a.clinicPatient.name });
    });
  }

  private async create(
    tx: Tx,
    a: { id: string; clinicId: string; doctorId: string; clinicPatientId: string; status: string; clinicPatient: { name: string } },
    input: ReviewInput, actor: Actor,
  ) {
    if (a.status !== 'COMPLETED') throw new ConflictException('Sólo se puede opinar sobre una cita atendida');
    const comment = input.comment?.trim() || null;
    try {
      const review = await tx.review.create({
        data: {
          clinicId: a.clinicId, doctorId: a.doctorId, appointmentId: a.id, clinicPatientId: a.clinicPatientId,
          ratingPunctuality: input.ratingPunctuality, ratingTreatment: input.ratingTreatment,
          ratingFacilities: input.ratingFacilities, comment, anonymous: input.anonymous ?? false,
          authorName: publicAuthor(a.clinicPatient.name, input.anonymous ?? false),
        },
      });
      await tx.reviewEvent.create({
        data: { reviewId: review.id, type: 'CREATED', actorKind: actor.kind, actorId: actor.id, actorName: actor.name },
      });
      return this.serializePublic(review);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya dejaste tu opinión sobre esta cita');
      }
      throw e;
    }
  }

  private async validInvitation(tx: Tx | PrismaService, token: string) {
    const inv = await tx.reviewInvitation.findUnique({ where: { tokenHash: sha256(token) } });
    if (!inv || inv.usedAt || inv.expiresAt <= new Date()) throw new BadRequestException(INVALID);
    return inv;
  }

  // ------------------------------------------------------------ Moderación

  async hide(staff: StaffContext, id: string, reason: string, note: string | null) {
    if (!HIDE_REASONS[reason]) throw new BadRequestException('Motivo de moderación inválido');
    return this.moderate(staff, id, 'HIDDEN', reason, note);
  }

  async restore(staff: StaffContext, id: string, note: string | null) {
    return this.moderate(staff, id, 'PUBLISHED', null, note);
  }

  private async moderate(staff: StaffContext, id: string, status: 'HIDDEN' | 'PUBLISHED', reason: string | null, note: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const r = await this.lock(tx, staff.clinicId, id);
      if (r.status === status) throw new ConflictException(status === 'HIDDEN' ? 'La opinión ya está oculta' : 'La opinión ya está publicada');
      const updated = await tx.review.update({ where: { id }, data: { status, hiddenReason: reason } });
      await tx.reviewEvent.create({
        data: {
          reviewId: id, type: status === 'HIDDEN' ? 'HIDDEN' : 'RESTORED', actorKind: 'STAFF', actorId: staff.userId,
          actorName: staff.name, reason, note,
        },
      });
      // Nunca en silencio: el paciente recibe el motivo.
      const a = await tx.appointment.findUniqueOrThrow({
        where: { id: r.appointmentId }, include: { clinic: true, doctor: true, clinicPatient: true },
      });
      if (a.clinicPatient.email) {
        await this.mail.reviewModerated(tx, {
          email: a.clinicPatient.email, patientName: a.clinicPatient.name, clinicName: a.clinic.name,
          doctorName: a.doctor.displayName, hidden: status === 'HIDDEN',
          reason: reason ? HIDE_REASONS[reason] : '', note,
        });
      }
      return this.serializeStaff({ ...updated, events: await tx.reviewEvent.findMany({ where: { reviewId: id }, orderBy: { createdAt: 'asc' } }) });
    });
  }

  /** Respuesta pública: la escribe el médico de la cita, o propietario/administración en su nombre. */
  async reply(staff: StaffContext, id: string, text: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const r = await this.lock(tx, staff.clinicId, id);
      if (staff.role === 'DOCTOR' ? staff.doctorId !== r.doctorId : staff.role === 'RECEPTION') {
        throw new ForbiddenException('Sólo el médico o la administración pueden responder');
      }
      if (!text && !r.reply) throw new ConflictException('La opinión no tiene respuesta');
      const updated = await tx.review.update({
        where: { id },
        data: text ? { reply: text, replyAt: new Date(), replyByName: staff.name } : { reply: null, replyAt: null, replyByName: null },
      });
      await tx.reviewEvent.create({
        data: {
          reviewId: id, type: text ? 'REPLIED' : 'REPLY_REMOVED', actorKind: 'STAFF', actorId: staff.userId, actorName: staff.name,
          note: text ? text.slice(0, 500) : null,
        },
      });
      return this.serializeStaff({ ...updated, events: await tx.reviewEvent.findMany({ where: { reviewId: id }, orderBy: { createdAt: 'asc' } }) });
    });
  }

  private async lock(tx: Tx, clinicId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM "Review" WHERE id = ${id}::uuid FOR UPDATE`;
    const r = await tx.review.findFirst({ where: { id, clinicId } });
    if (!r) throw new NotFoundException('Opinión no encontrada');
    return r;
  }

  async listForStaff(staff: StaffContext, filter: { status?: 'PUBLISHED' | 'HIDDEN'; doctorId?: string }) {
    const doctorId = staff.role === 'DOCTOR' ? staff.doctorId ?? '00000000-0000-0000-0000-000000000000' : filter.doctorId;
    const rows = await this.prisma.review.findMany({
      where: { clinicId: staff.clinicId, ...(filter.status ? { status: filter.status } : {}), ...(doctorId ? { doctorId } : {}) },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        appointment: { select: { startsAt: true, serviceName: true, doctor: { select: { id: true, displayName: true } }, clinicPatient: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      ...this.serializeStaff(r),
      appointment: { startsAt: r.appointment.startsAt, serviceName: r.appointment.serviceName },
      doctor: r.appointment.doctor,
      patientName: r.appointment.clinicPatient.name,
    }));
  }

  // --------------------------------------------------------------- Público

  /** Promedios de las opiniones publicadas, por médico. */
  async summaries(doctorIds: string[]): Promise<Map<string, RatingSummary>> {
    const rows = await this.prisma.review.groupBy({
      by: ['doctorId'],
      where: { doctorId: { in: doctorIds }, status: 'PUBLISHED' },
      _count: { _all: true },
      _avg: { ratingPunctuality: true, ratingTreatment: true, ratingFacilities: true },
    });
    const round = (n: number | null) => Math.round((n ?? 0) * 10) / 10;
    return new Map(rows.map((r) => {
      const p = round(r._avg.ratingPunctuality); const t = round(r._avg.ratingTreatment); const f = round(r._avg.ratingFacilities);
      return [r.doctorId, {
        count: r._count._all,
        average: round(((r._avg.ratingPunctuality ?? 0) + (r._avg.ratingTreatment ?? 0) + (r._avg.ratingFacilities ?? 0)) / 3),
        punctuality: p, treatment: t, facilities: f,
      }];
    }));
  }

  async publicList(doctorId: string, page: number) {
    const take = 10;
    const rows = await this.prisma.review.findMany({
      where: { doctorId, status: 'PUBLISHED' },
      include: { appointment: { select: { startsAt: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * take, take: take + 1,
    });
    return {
      reviews: rows.slice(0, take).map((r) => ({ ...this.serializePublic(r), visitedAt: r.appointment.startsAt })),
      hasMore: rows.length > take,
    };
  }

  serializePublic(r: {
    id: string; ratingPunctuality: number; ratingTreatment: number; ratingFacilities: number; comment: string | null;
    authorName: string; createdAt: Date; reply: string | null; replyAt: Date | null; replyByName: string | null;
  }) {
    return {
      id: r.id, authorName: r.authorName, rating: average(r),
      ratings: { punctuality: r.ratingPunctuality, treatment: r.ratingTreatment, facilities: r.ratingFacilities },
      comment: r.comment, createdAt: r.createdAt,
      reply: r.reply ? { text: r.reply, at: r.replyAt, by: r.replyByName } : null,
    };
  }

  private serializeStaff(r: Parameters<ReviewsService['serializePublic']>[0] & {
    status: string; hiddenReason: string | null; anonymous: boolean;
    events: { type: string; actorName: string; reason: string | null; note: string | null; createdAt: Date }[];
  }) {
    return {
      ...this.serializePublic(r), status: r.status, anonymous: r.anonymous,
      hiddenReason: r.hiddenReason ? { code: r.hiddenReason, label: HIDE_REASONS[r.hiddenReason] } : null,
      events: r.events.map(({ type, actorName, reason, note, createdAt }) => ({ type, actorName, reason, note, createdAt })),
    };
  }
}

const INVALID = 'El enlace no es válido, ya se usó o venció.';
