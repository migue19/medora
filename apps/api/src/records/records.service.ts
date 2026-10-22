import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createCipheriv, createDecipheriv, randomBytes, randomInt } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService, Tx } from '../prisma.service';
import type { StaffContext } from '../auth/guards';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Tipos de adjunto aceptados: estudios en PDF e imágenes. */
export const FILE_TYPES: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
};

/** Secciones de la historia clínica (NOM-004-SSA3-2012, 6.1). */
export const HISTORY_SECTIONS = [
  'heredofamiliares', 'personalesPatologicos', 'personalesNoPatologicos', 'ginecoObstetricos', 'padecimientoActual',
  'interrogatorioSistemas', 'exploracionFisica', 'estudios', 'diagnosticos', 'pronostico', 'tratamiento',
] as const;

export const VITAL_RANGES: Record<string, [number, number]> = {
  systolic: [50, 260], diastolic: [30, 160], heartRate: [20, 250], respRate: [5, 80], temperature: [30, 45],
  spo2: [50, 100], weightKg: [0.5, 400], heightCm: [30, 250], glucose: [20, 800],
};

export const ICD10_CODE = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,2})?$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type ClinicalAction =
  | 'VIEW_RECORD' | 'UPDATE_HISTORY' | 'ADD_ALLERGY' | 'UPDATE_ALLERGY' | 'CREATE_NOTE' | 'UPDATE_NOTE' | 'SIGN_NOTE'
  | 'PRESCRIBE' | 'PRINT_PRESCRIPTION' | 'VOID_PRESCRIPTION' | 'UPLOAD_FILE' | 'DOWNLOAD_FILE' | 'VIEW_LOG' | 'DENIED';

export interface Diagnosis { code: string | null; description: string }
export interface PrescriptionItem {
  drug: string; presentation: string; dose: string; route: string; frequency: string; duration: string; instructions?: string;
}

interface Access { read: boolean; write: boolean; doctorId: string | null }

/**
 * Expediente clínico. Lo ve el médico tratante (con citas o notas del paciente) y quien la dirección autorice;
 * recepción nunca. Toda consulta, cambio, impresión e intento denegado queda en la bitácora.
 */
@Injectable()
export class RecordsService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig, private readonly prisma: PrismaService) {}

  get filesEnabled() {
    return this.config.recordsKey !== null;
  }

  // ---------------------------------------------------------------- acceso y bitácora

  /** Quién puede ver y escribir el expediente de un paciente. */
  async access(staff: StaffContext, clinicPatientId: string): Promise<Access> {
    if (staff.role === 'RECEPTION') return { read: false, write: false, doctorId: null };
    const membership = await this.prisma.membership.findUniqueOrThrow({ where: { id: staff.membershipId } });
    let treating = false;
    if (staff.doctorId) {
      const [appointments, notes] = await Promise.all([
        this.prisma.appointment.count({ where: { clinicPatientId, doctorId: staff.doctorId } }),
        this.prisma.clinicalNote.count({ where: { clinicPatientId, doctorId: staff.doctorId } }),
      ]);
      treating = appointments + notes > 0;
    }
    const read = treating || membership.clinicalAccess;
    // Sólo un médico (usuario vinculado a un perfil de médico) documenta y receta.
    return { read, write: read && staff.doctorId !== null, doctorId: staff.doctorId };
  }

  async log(
    db: Tx | PrismaService, staff: StaffContext, clinicPatientId: string, action: ClinicalAction,
    resourceId: string | null = null, ip: string | null = null,
  ) {
    await db.clinicalAccessLog.create({
      data: {
        clinicId: staff.clinicId, clinicPatientId, userId: staff.userId, userName: staff.name, role: staff.role, action,
        resourceId, ip: ip?.slice(0, 64) ?? null,
      },
    });
  }

  /** Verifica el acceso; un intento sin permiso también queda en la bitácora. */
  private async require(staff: StaffContext, clinicPatientId: string, need: 'read' | 'write', ip: string | null) {
    const patient = await this.prisma.clinicPatient.findFirst({ where: { id: clinicPatientId, clinicId: staff.clinicId, mergedIntoId: null } });
    if (!patient) throw new NotFoundException('Paciente no encontrado');
    const access = await this.access(staff, clinicPatientId);
    if (!access[need]) {
      await this.log(this.prisma, staff, clinicPatientId, 'DENIED', null, ip);
      throw new ForbiddenException(need === 'write' && access.read
        ? 'Sólo el médico tratante documenta en el expediente'
        : 'No tienes acceso al expediente clínico de este paciente');
    }
    return { patient, access };
  }

  // ---------------------------------------------------------------- lectura

  async record(staff: StaffContext, clinicPatientId: string, ip: string | null) {
    const { patient, access } = await this.require(staff, clinicPatientId, 'read', ip);
    const [profile, allergies, notes, prescriptions, files] = await Promise.all([
      this.prisma.clinicalProfile.findUnique({ where: { clinicPatientId } }),
      this.prisma.allergy.findMany({ where: { clinicPatientId }, orderBy: [{ active: 'desc' }, { createdAt: 'desc' }] }),
      this.prisma.clinicalNote.findMany({ where: { clinicPatientId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.prescription.findMany({ where: { clinicPatientId }, orderBy: { issuedAt: 'desc' } }),
      this.prisma.clinicalFile.findMany({
        where: { clinicPatientId }, orderBy: { createdAt: 'desc' },
        select: { id: true, filename: true, mimeType: true, size: true, noteId: true, uploadedByName: true, createdAt: true },
      }),
    ]);
    const doctors = await this.prisma.doctor.findMany({
      where: { id: { in: [...new Set([...notes.map((n) => n.doctorId), ...prescriptions.map((p) => p.doctorId)])] } },
      select: { id: true, displayName: true, licenseNumber: true },
    });
    const doctorName = (id: string) => doctors.find((d) => d.id === id)?.displayName ?? '';
    await this.log(this.prisma, staff, clinicPatientId, 'VIEW_RECORD', null, ip);
    return {
      patient: { id: patient.id, name: patient.name, phone: patient.phone, email: patient.email },
      canWrite: access.write, filesEnabled: this.filesEnabled,
      profile: profile && {
        birthDate: profile.birthDate?.toISOString().slice(0, 10) ?? null, sex: profile.sex, curp: profile.curp,
        bloodType: profile.bloodType, history: profile.history, updatedByName: profile.updatedByName, updatedAt: profile.updatedAt,
      },
      allergies,
      notes: notes.map((n) => ({ ...n, doctorName: doctorName(n.doctorId), mine: n.doctorId === access.doctorId })),
      prescriptions: prescriptions.map((p) => ({ ...p, doctorName: doctorName(p.doctorId) })),
      files,
    };
  }

  async accessLog(staff: StaffContext, clinicPatientId: string, ip: string | null) {
    await this.require(staff, clinicPatientId, 'read', ip);
    const rows = await this.prisma.clinicalAccessLog.findMany({ where: { clinicPatientId }, orderBy: { createdAt: 'desc' }, take: 300 });
    await this.log(this.prisma, staff, clinicPatientId, 'VIEW_LOG', null, ip);
    return rows.map(({ userName, role, action, resourceId, createdAt }) => ({ userName, role, action, resourceId, createdAt }));
  }

  /** Bitácora de toda la clínica (propietario): quién vio qué expediente. */
  async clinicLog(staff: StaffContext, from: Date, to: Date) {
    const rows = await this.prisma.clinicalAccessLog.findMany({
      where: { clinicId: staff.clinicId, createdAt: { gte: from, lt: to } }, orderBy: { createdAt: 'desc' }, take: 1000,
    });
    const patients = await this.prisma.clinicPatient.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.clinicPatientId))] } }, select: { id: true, name: true },
    });
    return rows.map((r) => ({
      userName: r.userName, role: r.role, action: r.action, createdAt: r.createdAt, ip: r.ip,
      patient: patients.find((p) => p.id === r.clinicPatientId) ?? { id: r.clinicPatientId, name: '—' },
    }));
  }

  // ---------------------------------------------------------------- historia clínica y alergias

  async updateProfile(staff: StaffContext, clinicPatientId: string, dto: {
    birthDate?: string | null; sex?: string | null; curp?: string | null; bloodType?: string | null; history?: Record<string, string>;
  }, ip: string | null) {
    await this.require(staff, clinicPatientId, 'write', ip);
    const history = dto.history
      ? Object.fromEntries(HISTORY_SECTIONS.map((k) => [k, String(dto.history![k] ?? '').slice(0, 5000)]).filter(([, v]) => v))
      : undefined;
    const data = {
      ...(dto.birthDate !== undefined ? { birthDate: dto.birthDate ? new Date(`${dto.birthDate}T00:00:00Z`) : null } : {}),
      ...(dto.sex !== undefined ? { sex: dto.sex } : {}),
      ...(dto.curp !== undefined ? { curp: dto.curp ? dto.curp.toUpperCase() : null } : {}),
      ...(dto.bloodType !== undefined ? { bloodType: dto.bloodType } : {}),
      ...(history ? { history } : {}),
      updatedById: staff.userId, updatedByName: staff.name,
    };
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.clinicalProfile.upsert({
        where: { clinicPatientId }, update: data, create: { clinicPatientId, clinicId: staff.clinicId, ...data },
      });
      const { createdAt: _c, updatedAt: _u, ...snapshot } = profile;
      await tx.clinicalHistoryVersion.create({
        data: { clinicPatientId, snapshot: snapshot as Prisma.InputJsonValue, authorId: staff.userId, authorName: staff.name },
      });
      await this.log(tx, staff, clinicPatientId, 'UPDATE_HISTORY', null, ip);
      return profile;
    });
  }

  async addAllergy(staff: StaffContext, clinicPatientId: string, dto: { substance: string; reaction?: string | null; severity: string }, ip: string | null) {
    await this.require(staff, clinicPatientId, 'write', ip);
    return this.prisma.$transaction(async (tx) => {
      const allergy = await tx.allergy.create({
        data: {
          clinicId: staff.clinicId, clinicPatientId, substance: dto.substance, reaction: dto.reaction ?? null, severity: dto.severity,
          recordedById: staff.userId, recordedByName: staff.name,
        },
      });
      await this.log(tx, staff, clinicPatientId, 'ADD_ALLERGY', allergy.id, ip);
      return allergy;
    });
  }

  /** Una alergia descartada se marca inactiva (no se borra). */
  async setAllergyActive(staff: StaffContext, clinicPatientId: string, allergyId: string, active: boolean, ip: string | null) {
    await this.require(staff, clinicPatientId, 'write', ip);
    const allergy = await this.prisma.allergy.findFirst({ where: { id: allergyId, clinicPatientId } });
    if (!allergy) throw new NotFoundException('Alergia no encontrada');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.allergy.update({ where: { id: allergyId }, data: { active } });
      await this.log(tx, staff, clinicPatientId, 'UPDATE_ALLERGY', allergyId, ip);
      return updated;
    });
  }

  // ---------------------------------------------------------------- notas de evolución

  private cleanVitals(v: Record<string, unknown> | undefined) {
    const out: Record<string, number> = {};
    for (const [k, [min, max]] of Object.entries(VITAL_RANGES)) {
      const n = v?.[k];
      if (n === undefined || n === null || n === '') continue;
      const num = Number(n);
      if (!Number.isFinite(num) || num < min || num > max) throw new BadRequestException(`Signo vital fuera de rango: ${k}`);
      out[k] = Math.round(num * 10) / 10;
    }
    return out;
  }

  private cleanDiagnoses(list: Diagnosis[] | undefined): Diagnosis[] {
    return (list ?? []).map((d) => {
      const code = d.code ? d.code.trim().toUpperCase() : null;
      if (code && !ICD10_CODE.test(code)) throw new BadRequestException(`Código CIE-10 inválido: ${code}`);
      return { code, description: d.description.trim().slice(0, 255) };
    });
  }

  async createNote(staff: StaffContext, clinicPatientId: string, dto: {
    appointmentId?: string | null; amendsId?: string | null; subjective?: string; objective?: string; assessment?: string; plan?: string;
    vitals?: Record<string, unknown>; diagnoses?: Diagnosis[];
  }, ip: string | null) {
    const { access } = await this.require(staff, clinicPatientId, 'write', ip);
    if (dto.appointmentId) {
      const a = await this.prisma.appointment.findFirst({ where: { id: dto.appointmentId, clinicPatientId, doctorId: access.doctorId! } });
      if (!a) throw new BadRequestException('La cita no es de este paciente con este médico');
    }
    if (dto.amendsId) {
      const original = await this.prisma.clinicalNote.findFirst({ where: { id: dto.amendsId, clinicPatientId } });
      if (!original?.signedAt) throw new BadRequestException('Sólo se agregan adendas a notas firmadas');
    }
    return this.prisma.$transaction(async (tx) => {
      const note = await tx.clinicalNote.create({
        data: {
          clinicId: staff.clinicId, clinicPatientId, appointmentId: dto.appointmentId ?? null, amendsId: dto.amendsId ?? null,
          doctorId: access.doctorId!, authorId: staff.userId, authorName: staff.name,
          subjective: dto.subjective ?? '', objective: dto.objective ?? '', assessment: dto.assessment ?? '', plan: dto.plan ?? '',
          vitals: this.cleanVitals(dto.vitals), diagnoses: this.cleanDiagnoses(dto.diagnoses) as unknown as Prisma.InputJsonValue,
        },
      });
      await this.log(tx, staff, clinicPatientId, 'CREATE_NOTE', note.id, ip);
      return note;
    });
  }

  private async ownDraft(staff: StaffContext, clinicPatientId: string, noteId: string, ip: string | null) {
    const { access } = await this.require(staff, clinicPatientId, 'write', ip);
    const note = await this.prisma.clinicalNote.findFirst({ where: { id: noteId, clinicPatientId } });
    if (!note) throw new NotFoundException('Nota no encontrada');
    if (note.doctorId !== access.doctorId) throw new ForbiddenException('Sólo el médico que la escribió puede editarla');
    if (note.signedAt) throw new ConflictException('La nota ya está firmada: agrega una adenda');
    return note;
  }

  async updateNote(staff: StaffContext, clinicPatientId: string, noteId: string, dto: {
    subjective?: string; objective?: string; assessment?: string; plan?: string; vitals?: Record<string, unknown>; diagnoses?: Diagnosis[];
  }, ip: string | null) {
    await this.ownDraft(staff, clinicPatientId, noteId, ip);
    return this.prisma.$transaction(async (tx) => {
      const note = await tx.clinicalNote.update({
        where: { id: noteId },
        data: {
          ...(dto.subjective !== undefined ? { subjective: dto.subjective } : {}),
          ...(dto.objective !== undefined ? { objective: dto.objective } : {}),
          ...(dto.assessment !== undefined ? { assessment: dto.assessment } : {}),
          ...(dto.plan !== undefined ? { plan: dto.plan } : {}),
          ...(dto.vitals !== undefined ? { vitals: this.cleanVitals(dto.vitals) } : {}),
          ...(dto.diagnoses !== undefined ? { diagnoses: this.cleanDiagnoses(dto.diagnoses) as unknown as Prisma.InputJsonValue } : {}),
        },
      });
      await this.log(tx, staff, clinicPatientId, 'UPDATE_NOTE', noteId, ip);
      return note;
    });
  }

  async signNote(staff: StaffContext, clinicPatientId: string, noteId: string, ip: string | null) {
    const note = await this.ownDraft(staff, clinicPatientId, noteId, ip);
    if (!note.subjective.trim() && !note.assessment.trim() && !note.plan.trim()) {
      throw new BadRequestException('La nota está vacía');
    }
    return this.prisma.$transaction(async (tx) => {
      const signed = await tx.clinicalNote.update({ where: { id: noteId }, data: { signedAt: new Date() } });
      await this.log(tx, staff, clinicPatientId, 'SIGN_NOTE', noteId, ip);
      return signed;
    });
  }

  // ---------------------------------------------------------------- recetas

  async prescribe(staff: StaffContext, clinicPatientId: string, dto: {
    noteId?: string | null; items: PrescriptionItem[]; instructions?: string | null; diagnosis?: string | null;
  }, ip: string | null) {
    const { access } = await this.require(staff, clinicPatientId, 'write', ip);
    if (dto.noteId && !(await this.prisma.clinicalNote.findFirst({ where: { id: dto.noteId, clinicPatientId } }))) {
      throw new BadRequestException('Nota no encontrada');
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from({ length: 10 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      try {
        return await this.prisma.$transaction(async (tx) => {
          const p = await tx.prescription.create({
            data: {
              clinicId: staff.clinicId, clinicPatientId, noteId: dto.noteId ?? null, doctorId: access.doctorId!, authorId: staff.userId,
              code, items: dto.items as unknown as Prisma.InputJsonValue, instructions: dto.instructions ?? null, diagnosis: dto.diagnosis ?? null,
            },
          });
          await this.log(tx, staff, clinicPatientId, 'PRESCRIBE', p.id, ip);
          return p;
        });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    throw new ConflictException('No se pudo generar el código de la receta; inténtalo de nuevo');
  }

  async voidPrescription(staff: StaffContext, clinicPatientId: string, prescriptionId: string, reason: string, ip: string | null) {
    const { access } = await this.require(staff, clinicPatientId, 'write', ip);
    const p = await this.prisma.prescription.findFirst({ where: { id: prescriptionId, clinicPatientId } });
    if (!p) throw new NotFoundException('Receta no encontrada');
    if (p.doctorId !== access.doctorId) throw new ForbiddenException('Sólo el médico que la emitió puede anularla');
    if (p.voidedAt) return p;
    return this.prisma.$transaction(async (tx) => {
      const voided = await tx.prescription.update({ where: { id: p.id }, data: { voidedAt: new Date(), voidReason: reason } });
      await this.log(tx, staff, clinicPatientId, 'VOID_PRESCRIPTION', p.id, ip);
      return voided;
    });
  }

  /** Datos completos para imprimir la receta (y registra la impresión). */
  async prescriptionForPrint(staff: StaffContext, clinicPatientId: string, prescriptionId: string, ip: string | null) {
    await this.require(staff, clinicPatientId, 'read', ip);
    const data = await this.prescriptionData({ id: prescriptionId, clinicPatientId });
    if (!data) throw new NotFoundException('Receta no encontrada');
    await this.log(this.prisma, staff, clinicPatientId, 'PRINT_PRESCRIPTION', prescriptionId, ip);
    return data;
  }

  async prescriptionData(where: Prisma.PrescriptionWhereInput) {
    const p = await this.prisma.prescription.findFirst({
      where, include: { clinicPatient: { include: { clinicalProfile: true } } },
    });
    if (!p) return null;
    const [doctor, clinic, location] = await Promise.all([
      this.prisma.doctor.findUniqueOrThrow({ where: { id: p.doctorId } }),
      this.prisma.clinic.findUniqueOrThrow({ where: { id: p.clinicId } }),
      this.prisma.location.findFirst({ where: { clinicId: p.clinicId, active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    const profile = p.clinicPatient.clinicalProfile;
    return {
      prescription: p, doctor, clinic, location, patientName: p.clinicPatient.name,
      birthDate: profile?.birthDate ?? null, sex: profile?.sex ?? null,
      allergies: await this.prisma.allergy.findMany({ where: { clinicPatientId: p.clinicPatientId, active: true } }),
      vitals: p.noteId ? ((await this.prisma.clinicalNote.findUnique({ where: { id: p.noteId } }))?.vitals as Record<string, number> | undefined) ?? null : null,
    };
  }

  /** Verificación pública por código (farmacias): sin datos sensibles del paciente. */
  async verify(code: string) {
    const data = await this.prescriptionData({ code: code.toUpperCase() });
    if (!data) return null;
    const { prescription: p, doctor, clinic } = data;
    const initials = data.patientName.split(/\s+/).filter(Boolean).map((w) => `${w[0]}.`).join(' ');
    return {
      code: p.code, issuedAt: p.issuedAt, voided: p.voidedAt !== null, voidedAt: p.voidedAt,
      doctor: { name: doctor.displayName, specialty: doctor.specialty, licenseNumber: doctor.licenseNumber },
      clinic: clinic.name, patientInitials: initials, items: p.items as unknown as PrescriptionItem[],
    };
  }

  // ---------------------------------------------------------------- adjuntos cifrados

  async upload(staff: StaffContext, clinicPatientId: string, file: { buffer: Buffer; originalname: string }, noteId: string | null, ip: string | null) {
    if (!this.config.recordsKey) throw new ConflictException('Los adjuntos no están habilitados en este servidor');
    await this.require(staff, clinicPatientId, 'write', ip);
    if (!file.buffer.length || file.buffer.length > MAX_FILE_BYTES) throw new BadRequestException('El archivo debe pesar hasta 10 MB');
    const mimeType = Object.keys(FILE_TYPES).find((t) => FILE_TYPES[t](file.buffer));
    if (!mimeType) throw new BadRequestException('Sólo se aceptan PDF, JPG o PNG');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.config.recordsKey, iv);
    const data = Buffer.concat([cipher.update(file.buffer), cipher.final()]);
    const filename = (file.originalname || 'archivo').replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 200);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.clinicalFile.create({
        data: {
          clinicId: staff.clinicId, clinicPatientId, noteId, filename, mimeType, size: file.buffer.length,
          iv, tag: cipher.getAuthTag(), data, uploadedById: staff.userId, uploadedByName: staff.name,
        },
        select: { id: true, filename: true, mimeType: true, size: true, noteId: true, uploadedByName: true, createdAt: true },
      });
      await this.log(tx, staff, clinicPatientId, 'UPLOAD_FILE', row.id, ip);
      return row;
    });
  }

  async download(staff: StaffContext, clinicPatientId: string, fileId: string, ip: string | null) {
    if (!this.config.recordsKey) throw new ConflictException('Los adjuntos no están habilitados en este servidor');
    await this.require(staff, clinicPatientId, 'read', ip);
    const f = await this.prisma.clinicalFile.findFirst({ where: { id: fileId, clinicPatientId } });
    if (!f) throw new NotFoundException('Archivo no encontrado');
    const decipher = createDecipheriv('aes-256-gcm', this.config.recordsKey, Buffer.from(f.iv));
    decipher.setAuthTag(Buffer.from(f.tag));
    const content = Buffer.concat([decipher.update(Buffer.from(f.data)), decipher.final()]);
    await this.log(this.prisma, staff, clinicPatientId, 'DOWNLOAD_FILE', f.id, ip);
    return { filename: f.filename, mimeType: f.mimeType, content };
  }

  // ---------------------------------------------------------------- catálogo

  async searchIcd10(q: string) {
    const text = q.trim();
    if (text.length < 2) return [];
    const upper = text.toUpperCase();
    return this.prisma.$queryRaw<{ code: string; description: string }[]>`
      SELECT code, description FROM "Icd10"
      WHERE code ILIKE ${`${upper}%`} OR f_unaccent(lower(description)) LIKE ${`%${text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}%`}
      ORDER BY (code ILIKE ${`${upper}%`}) DESC, code LIMIT 15`;
  }
}
