import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PatientAuditAction, Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../prisma.service';
import { Actor } from '../appointments/appointments.service';
import { randomToken, sha256 } from '../common/crypto';
import { normalizeEmail } from '../common/http';
import { MailService } from '../mail/mail.service';
import { StaffContext } from '../auth/guards';

export const LINK_TTL_MS = 7 * 24 * 60 * 60_000;
export const MAX_TAGS = 10;

export const PATIENT_SELECT = {
  id: true, name: true, phone: true, email: true, patientAccountId: true, createdAt: true, whatsappConsentAt: true,
  tags: true, patientAccount: { select: { whatsappConsentAt: true, emailVerifiedAt: true } },
} as const;

type PatientRow = Prisma.ClinicPatientGetPayload<{ select: typeof PATIENT_SELECT }>;

export function serializePatient(p: PatientRow) {
  const { patientAccount, whatsappConsentAt, ...rest } = p;
  return {
    ...rest,
    linked: patientAccount !== null,
    // En pacientes con cuenta en línea el consentimiento lo da el propio paciente.
    whatsappConsent: (patientAccount ? patientAccount.whatsappConsentAt : whatsappConsentAt) !== null,
  };
}

export function staffActor(staff: StaffContext): Actor {
  return { kind: 'STAFF', id: staff.userId, name: staff.name };
}

/** Normaliza etiquetas: minúsculas, sin espacios extra, sin repetir y como máximo 10 de 30 caracteres. */
export function normalizeTags(tags: string[]): string[] {
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean))];
  if (clean.some((t) => t.length > 30)) throw new BadRequestException('Cada etiqueta puede tener hasta 30 caracteres');
  if (clean.length > MAX_TAGS) throw new BadRequestException(`Máximo ${MAX_TAGS} etiquetas`);
  return clean;
}

export interface PatientUpdate {
  name?: string;
  phone?: string;
  email?: string | null;
  tags?: string[];
  whatsappConsent?: boolean;
}

@Injectable()
export class PatientsService {
  constructor(private readonly prisma: PrismaService, private readonly mail: MailService) {}

  async audit(
    tx: Tx | PrismaService, clinicId: string, clinicPatientId: string, action: PatientAuditAction, actor: Actor,
    details: Prisma.InputJsonValue,
  ) {
    await tx.patientAudit.create({
      data: { clinicId, clinicPatientId, action, actorKind: actor.kind, actorId: actor.id, actorName: actor.name, details },
    });
  }

  /** Ficha vigente (no fusionada) de la clínica. */
  async find(tx: Tx | PrismaService, clinicId: string, id: string) {
    const p = await tx.clinicPatient.findFirst({ where: { id, clinicId, mergedIntoId: null } });
    if (!p) throw new NotFoundException('Paciente no encontrado');
    return p;
  }

  /** Expediente administrativo del paciente en la clínica. El médico sólo ve sus propias citas. */
  async profile(staff: StaffContext, id: string) {
    const patient = await this.prisma.clinicPatient.findFirst({
      where: { id, clinicId: staff.clinicId, mergedIntoId: null }, select: PATIENT_SELECT,
    });
    if (!patient) throw new NotFoundException('Paciente no encontrado');
    const doctorOnly = staff.role === 'DOCTOR';
    if (doctorOnly) {
      const seen = staff.doctorId
        ? await this.prisma.appointment.count({ where: { clinicPatientId: id, doctorId: staff.doctorId } })
        : 0;
      if (!seen) throw new NotFoundException('Paciente no encontrado');
    }
    const apptWhere = { clinicPatientId: id, ...(doctorOnly ? { doctorId: staff.doctorId! } : {}) };
    const [appointments, counts, notes, audit, waitlist, pendingLink] = await Promise.all([
      this.prisma.appointment.findMany({
        where: apptWhere, orderBy: { startsAt: 'desc' }, take: 200,
        select: {
          id: true, startsAt: true, endsAt: true, status: true, source: true, serviceId: true, serviceName: true,
          priceCents: true, cancelReason: true, confirmedAt: true, patientNotes: true, followUpOfId: true,
          doctor: { select: { id: true, displayName: true } },
        },
      }),
      this.prisma.appointment.groupBy({ by: ['status'], where: apptWhere, _count: { _all: true } }),
      this.prisma.patientNote.findMany({ where: { clinicPatientId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      doctorOnly ? Promise.resolve([]) : this.prisma.patientAudit.findMany({
        where: { clinicPatientId: id }, orderBy: { createdAt: 'desc' }, take: 50,
        select: { id: true, action: true, actorKind: true, actorName: true, details: true, createdAt: true },
      }),
      this.prisma.waitlistEntry.findMany({
        where: { clinicPatientId: id, status: 'WAITING' }, orderBy: { createdAt: 'asc' },
        select: { id: true, doctorId: true, serviceId: true, fromDate: true, toDate: true, notes: true, createdAt: true },
      }),
      this.prisma.patientLinkRequest.findFirst({
        where: { clinicPatientId: id, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' },
        select: { createdAt: true, expiresAt: true },
      }),
    ]);
    const now = new Date();
    const count = (status: string) => counts.find((c) => c.status === status)?._count._all ?? 0;
    return {
      patient: { ...serializePatient(patient), emailVerified: patient.patientAccount?.emailVerifiedAt != null },
      stats: {
        total: appointments.length,
        upcoming: appointments.filter((a) => a.status === 'BOOKED' && a.startsAt > now).length,
        completed: count('COMPLETED'),
        noShow: count('NO_SHOW'),
        cancelled: count('CANCELLED'),
      },
      appointments, notes, audit, waitlist, pendingLink,
    };
  }

  async update(staff: StaffContext, id: string, dto: PatientUpdate) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ClinicPatient" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await this.find(tx, staff.clinicId, id);
      const personal = dto.name !== undefined || dto.phone !== undefined || dto.email !== undefined;
      if (current.patientAccountId && (personal || dto.whatsappConsent !== undefined)) {
        throw new ForbiddenException(
          'Este paciente tiene cuenta en línea: él mismo actualiza sus datos y su preferencia de WhatsApp',
        );
      }
      const data: Prisma.ClinicPatientUpdateInput = {};
      const changes: Record<string, [unknown, unknown]> = {};
      const set = <K extends 'name' | 'phone' | 'email'>(key: K, value: string | null | undefined) => {
        if (value === undefined || value === current[key]) return;
        data[key] = value as never;
        changes[key] = [current[key], value];
      };
      set('name', dto.name);
      set('phone', dto.phone);
      set('email', dto.email === undefined ? undefined : dto.email ? normalizeEmail(dto.email) : null);
      if (dto.tags !== undefined) {
        const tags = normalizeTags(dto.tags);
        if (tags.join('|') !== current.tags.join('|')) { data.tags = tags; changes.tags = [current.tags, tags]; }
      }
      if (dto.whatsappConsent !== undefined && dto.whatsappConsent !== (current.whatsappConsentAt !== null)) {
        data.whatsappConsentAt = dto.whatsappConsent ? new Date() : null;
        changes.whatsappConsent = [!dto.whatsappConsent, dto.whatsappConsent];
      }
      if (Object.keys(changes).length) {
        await tx.clinicPatient.update({ where: { id }, data });
        await this.audit(tx, staff.clinicId, id, 'UPDATED', staffActor(staff), changes as Prisma.InputJsonValue);
      }
      return serializePatient(await tx.clinicPatient.findUniqueOrThrow({ where: { id }, select: PATIENT_SELECT }));
    });
  }

  async addNote(staff: StaffContext, id: string, body: string) {
    await this.find(this.prisma, staff.clinicId, id);
    if (staff.role === 'DOCTOR') {
      const seen = staff.doctorId
        ? await this.prisma.appointment.count({ where: { clinicPatientId: id, doctorId: staff.doctorId } })
        : 0;
      if (!seen) throw new NotFoundException('Paciente no encontrado');
    }
    return this.prisma.patientNote.create({
      data: { clinicId: staff.clinicId, clinicPatientId: id, authorId: staff.userId, authorName: staff.name, body },
    });
  }

  /**
   * Fusiona la ficha `sourceId` en `targetId`: mueve citas, notas y lista de espera, une etiquetas y,
   * si la origen estaba vinculada a una cuenta en línea, la vinculación pasa al destino.
   * La ficha origen queda oculta (mergedIntoId) y la operación queda en la auditoría de ambas.
   */
  async mergeInto(tx: Tx, clinicId: string, targetId: string, sourceId: string, actor: Actor) {
    if (targetId === sourceId) throw new BadRequestException('Elige dos fichas distintas');
    // Orden fijo de bloqueo para evitar interbloqueos entre fusiones concurrentes.
    for (const id of [targetId, sourceId].sort()) {
      await tx.$queryRaw`SELECT id FROM "ClinicPatient" WHERE id = ${id}::uuid FOR UPDATE`;
    }
    const target = await this.find(tx, clinicId, targetId);
    const source = await this.find(tx, clinicId, sourceId);
    if (target.patientAccountId && source.patientAccountId) {
      throw new ConflictException('Las dos fichas tienen cuenta en línea distinta: no se pueden fusionar');
    }
    const clash = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "Appointment" a JOIN "Appointment" b
        ON a."clinicPatientId" = ${targetId}::uuid AND b."clinicPatientId" = ${sourceId}::uuid
       AND a.status = 'BOOKED' AND b.status = 'BOOKED'
       AND tstzrange(a."startsAt", a."endsAt", '[)') && tstzrange(b."startsAt", b."endsAt", '[)')`;
    if (clash[0].n > 0) throw new ConflictException('Las fichas tienen citas vigentes a la misma hora. Cancela una primero.');

    const moved = await tx.appointment.updateMany({ where: { clinicPatientId: sourceId }, data: { clinicPatientId: targetId } });
    await tx.patientNote.updateMany({ where: { clinicPatientId: sourceId }, data: { clinicPatientId: targetId } });
    // Expediente clínico: se mueve completo (la bitácora también). Dos historias clínicas no se fusionan solas.
    const profiles = await tx.clinicalProfile.count({ where: { clinicPatientId: { in: [sourceId, targetId] } } });
    if (profiles === 2) throw new ConflictException('Las dos fichas tienen historia clínica: el médico debe unificarlas antes de fusionar');
    for (const model of ['allergy', 'clinicalNote', 'prescription', 'clinicalFile', 'clinicalAccessLog', 'clinicalProfile'] as const) {
      await (tx[model] as unknown as { updateMany: (a: object) => Promise<unknown> })
        .updateMany({ where: { clinicPatientId: sourceId }, data: { clinicPatientId: targetId } });
    }
    await tx.clinicalHistoryVersion.updateMany({ where: { clinicPatientId: sourceId }, data: { clinicPatientId: targetId } });
    // Si ambos esperaban con el mismo médico y servicio, se conserva la entrada más antigua.
    const sourceWaiting = await tx.waitlistEntry.findMany({ where: { clinicPatientId: sourceId, status: 'WAITING' } });
    for (const e of sourceWaiting) {
      const dup = await tx.waitlistEntry.findFirst({
        where: { clinicPatientId: targetId, status: 'WAITING', doctorId: e.doctorId, serviceId: e.serviceId },
      });
      if (!dup) {
        await tx.waitlistEntry.update({ where: { id: e.id }, data: { clinicPatientId: targetId } });
      } else if (e.createdAt < dup.createdAt) {
        await tx.waitlistEntry.update({ where: { id: dup.id }, data: { status: 'REMOVED' } });
        await tx.waitlistEntry.update({ where: { id: e.id }, data: { clinicPatientId: targetId } });
      } else {
        await tx.waitlistEntry.update({ where: { id: e.id }, data: { status: 'REMOVED' } });
      }
    }
    await tx.waitlistEntry.updateMany({ where: { clinicPatientId: sourceId }, data: { clinicPatientId: targetId } });

    const accountId = target.patientAccountId ?? source.patientAccountId;
    const account = accountId ? await tx.patientAccount.findUniqueOrThrow({ where: { id: accountId } }) : null;
    await tx.clinicPatient.update({ where: { id: sourceId }, data: { mergedIntoId: targetId, patientAccountId: null } });
    await tx.clinicPatient.update({
      where: { id: targetId },
      data: {
        patientAccountId: accountId,
        tags: [...new Set([...target.tags, ...source.tags])].slice(0, MAX_TAGS),
        whatsappConsentAt: target.whatsappConsentAt ?? source.whatsappConsentAt,
        // Con cuenta en línea, los datos de contacto son los de la cuenta.
        ...(account
          ? { name: account.name, phone: account.phone, email: account.email }
          : { email: target.email ?? source.email }),
      },
    });
    const snapshot = {
      source: { id: source.id, name: source.name, phone: source.phone, email: source.email, tags: source.tags },
      target: { id: target.id, name: target.name, phone: target.phone, email: target.email },
      appointmentsMoved: moved.count,
      linkedAccount: accountId !== null && accountId !== target.patientAccountId,
    };
    await this.audit(tx, clinicId, targetId, 'MERGED', actor, snapshot);
    await this.audit(tx, clinicId, sourceId, 'MERGED', actor, { ...snapshot, mergedInto: targetId });
    return { appointmentsMoved: moved.count };
  }

  /** La clínica pide al paciente confirmar desde su correo que la ficha telefónica es suya. */
  async requestLink(staff: StaffContext, id: string, email: string) {
    return this.prisma.$transaction(async (tx) => {
      const patient = await this.find(tx, staff.clinicId, id);
      if (patient.patientAccountId) throw new ConflictException('Esta ficha ya está vinculada a una cuenta en línea');
      const account = await tx.patientAccount.findUnique({ where: { email: normalizeEmail(email) } });
      if (!account || !account.active) throw new NotFoundException('No hay una cuenta en línea activa con ese correo');
      const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: staff.clinicId } });
      // Una solicitud nueva reemplaza a las anteriores.
      await tx.patientLinkRequest.updateMany({ where: { clinicPatientId: id, usedAt: null }, data: { usedAt: new Date() } });
      const token = randomToken();
      const request = await tx.patientLinkRequest.create({
        data: {
          clinicId: staff.clinicId, clinicPatientId: id, patientAccountId: account.id, tokenHash: sha256(token),
          requestedById: staff.userId, expiresAt: new Date(Date.now() + LINK_TTL_MS),
        },
      });
      await this.mail.patientLinkRequest(tx, { email: account.email, patientName: account.name, clinicName: clinic.name, token });
      await this.audit(tx, staff.clinicId, id, 'LINK_REQUESTED', staffActor(staff), { email: account.email });
      return { expiresAt: request.expiresAt };
    });
  }

  async inspectLink(token: string) {
    const req = await this.prisma.patientLinkRequest.findUnique({ where: { tokenHash: sha256(token) } });
    if (!req || req.usedAt || req.expiresAt <= new Date()) throw new BadRequestException(LINK_INVALID);
    const [clinic, patient] = await Promise.all([
      this.prisma.clinic.findUniqueOrThrow({ where: { id: req.clinicId } }),
      this.prisma.clinicPatient.findUniqueOrThrow({ where: { id: req.clinicPatientId } }),
    ]);
    const upcoming = await this.prisma.appointment.count({
      where: { clinicPatientId: patient.id, status: { in: ['BOOKED', 'PENDING_PAYMENT'] }, startsAt: { gt: new Date() } },
    });
    return { clinic: { name: clinic.name }, patientName: patient.name, phoneEnd: patient.phone.replace(/\D/g, '').slice(-4), upcoming };
  }

  /** El paciente confirma: la ficha queda vinculada; si ya tenía otra ficha en línea en la clínica, se fusionan. */
  async acceptLink(token: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "PatientLinkRequest" WHERE "tokenHash" = ${sha256(token)} FOR UPDATE`;
      const req = rows.length ? await tx.patientLinkRequest.findUnique({ where: { id: rows[0].id } }) : null;
      if (!req || req.usedAt || req.expiresAt <= new Date()) throw new BadRequestException(LINK_INVALID);
      await tx.patientLinkRequest.update({ where: { id: req.id }, data: { usedAt: new Date() } });
      const account = await tx.patientAccount.findUnique({ where: { id: req.patientAccountId } });
      if (!account || !account.active) throw new BadRequestException(LINK_INVALID);
      const actor: Actor = { kind: 'PATIENT', id: account.id, name: account.name };
      const patient = await tx.clinicPatient.findFirst({ where: { id: req.clinicPatientId, mergedIntoId: null } });
      if (!patient) throw new BadRequestException(LINK_INVALID);
      if (patient.patientAccountId === account.id) return { linked: true, merged: false };
      if (patient.patientAccountId) throw new ConflictException('Esta ficha ya está vinculada a otra cuenta');
      // La cuenta ya reservó en línea en esta clínica: esa ficha se fusiona en la telefónica.
      const online = await tx.clinicPatient.findFirst({
        where: { clinicId: req.clinicId, patientAccountId: account.id, mergedIntoId: null },
      });
      if (online) {
        await this.mergeInto(tx, req.clinicId, patient.id, online.id, actor);
      } else {
        await tx.$queryRaw`SELECT id FROM "ClinicPatient" WHERE id = ${patient.id}::uuid FOR UPDATE`;
        await tx.clinicPatient.update({
          where: { id: patient.id },
          data: { patientAccountId: account.id, name: account.name, phone: account.phone, email: account.email },
        });
      }
      await this.audit(tx, req.clinicId, patient.id, 'LINKED', actor, {
        accountEmail: account.email, mergedOnlineRecord: online?.id ?? null,
      });
      return { linked: true, merged: online !== null };
    });
  }

  /** Los cambios del paciente en su perfil se reflejan en sus fichas de todas las clínicas. */
  async syncFromAccount(tx: Tx | PrismaService, account: { id: string; name: string; phone: string }) {
    await tx.clinicPatient.updateMany({
      where: { patientAccountId: account.id }, data: { name: account.name, phone: account.phone },
    });
  }
}

const LINK_INVALID = 'El enlace no es válido o ya venció. Pide a la clínica que te envíe uno nuevo.';
