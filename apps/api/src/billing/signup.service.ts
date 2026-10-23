import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ClinicVerification, Plan } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { AuthTokensService } from '../auth/auth-tokens.service';
import { MailService } from '../mail/mail.service';
import { randomToken } from '../common/crypto';
import { slugify, uniqueDoctorSlug } from '../common/slug';
import { accountExists, signupActivation, signupNotice, verificationResult } from '../mail/templates';
import { PLANS, TRIAL_DAYS, entitlements } from './plans';
import { BillingService } from './billing.service';

const ACTIVATION_TTL_MS = 7 * 24 * 60 * 60_000;

export interface SignupInput {
  clinicName: string; ownerName: string; email: string; phone: string; plan: Plan;
  doctorName: string; specialty: string; licenseNumber: string;
}

/** Alta autoservicio: clínica en prueba, propietario que activa su cuenta por correo y cédula por verificar. */
@Injectable()
export class SignupService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly authTokens: AuthTokensService,
    private readonly mail: MailService,
  ) {}

  /** Siempre responde igual (no revela si el correo ya tiene cuenta). */
  async signup(input: SignupInput, now = new Date()) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      await this.mail.queue(this.prisma, email, accountExists({
        name: existing.name, loginLink: `${this.config.webOrigin}/login`, recoverLink: `${this.config.webOrigin}/recuperar?tipo=personal`,
      }), `signup-exists:${existing.id}:${now.toISOString().slice(0, 13)}`);
      return { ok: true };
    }
    await this.prisma.$transaction(async (tx) => {
      const base = slugify(input.clinicName).slice(0, 50) || 'clinica';
      let slug = base;
      for (let i = 2; await tx.clinic.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
      const clinic = await tx.clinic.create({
        data: {
          name: input.clinicName.trim(), slug, phone: input.phone, plan: input.plan, subscriptionStatus: 'TRIALING',
          trialEndsAt: BillingService.trialEnd(now), verification: 'PENDING',
        },
      });
      await tx.location.create({ data: { clinicId: clinic.id, name: 'Sede principal', phone: input.phone } });
      const user = await tx.user.create({ data: { email, name: input.ownerName.trim(), passwordHash: `unset$${randomToken()}` } });
      const membership = await tx.membership.create({ data: { userId: user.id, clinicId: clinic.id, role: 'OWNER' } });
      // Quien registra la clínica atiende como médico (consultorio): su perfil queda vinculado a su usuario.
      await tx.doctor.create({
        data: {
          clinicId: clinic.id, displayName: input.doctorName.trim(), specialty: input.specialty.trim(), licenseNumber: input.licenseNumber,
          membershipId: membership.id, slug: await uniqueDoctorSlug(tx, clinic.id, slugify(input.doctorName)),
        },
      });
      const token = await this.authTokens.issue(tx, 'STAFF_RESET_PASSWORD', { userId: user.id }, email, ACTIVATION_TTL_MS);
      await this.mail.queue(tx, email, signupActivation({
        name: user.name, clinicName: clinic.name, slug, link: this.mail.link('/restablecer?tipo=personal', token),
        trialDays: TRIAL_DAYS, planName: PLANS[input.plan].name,
      }), `signup:${clinic.id}`);
      for (const admin of this.config.superadmins) {
        await this.mail.queue(tx, admin, signupNotice({
          clinicName: clinic.name, ownerName: user.name, email, doctorName: input.doctorName, licenseNumber: input.licenseNumber,
          adminLink: `${this.config.webOrigin}/admin`,
        }), `signup-notice:${clinic.id}:${admin}`);
      }
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------- administración de Medora

  async isSuperadmin(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return !!user && this.config.superadmins.includes(user.email.toLowerCase());
  }

  async clinics(now = new Date()) {
    const rows = await this.prisma.clinic.findMany({
      orderBy: [{ verification: 'asc' }, { createdAt: 'desc' }], take: 500,
      include: {
        doctors: { where: { active: true }, select: { displayName: true, specialty: true, licenseNumber: true } },
        memberships: { where: { role: 'OWNER' }, include: { user: { select: { name: true, email: true } } } },
      },
    });
    return rows.map((c) => ({
      id: c.id, name: c.name, slug: c.slug, phone: c.phone, createdAt: c.createdAt, plan: c.plan, status: c.subscriptionStatus,
      active: entitlements(c, now).active, exempt: c.billingExempt, trialEndsAt: c.trialEndsAt, currentPeriodEnd: c.currentPeriodEnd,
      verification: c.verification, verificationNote: c.verificationNote, verifiedAt: c.verifiedAt,
      doctors: c.doctors, owners: c.memberships.map((m) => m.user),
    }));
  }

  async review(id: string, dto: { verification?: ClinicVerification; note?: string | null; billingExempt?: boolean }) {
    const clinic = await this.prisma.clinic.findUnique({ where: { id }, include: { memberships: { where: { role: 'OWNER' }, include: { user: true } } } });
    if (!clinic) throw new NotFoundException('Clínica no encontrada');
    if (dto.verification === 'REJECTED' && !dto.note?.trim()) throw new ConflictException('Indica el motivo del rechazo');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.clinic.update({
        where: { id },
        data: {
          ...(dto.verification ? {
            verification: dto.verification, verificationNote: dto.note?.trim() || null,
            verifiedAt: dto.verification === 'VERIFIED' ? new Date() : null,
            // Rechazada: deja de aparecer en el directorio.
            ...(dto.verification === 'REJECTED' ? { directoryEnabled: false } : {}),
          } : {}),
          ...(dto.billingExempt !== undefined ? { billingExempt: dto.billingExempt } : {}),
        },
      });
      if (dto.verification && dto.verification !== clinic.verification && dto.verification !== 'PENDING') {
        for (const m of clinic.memberships) {
          await this.mail.queue(tx, m.user.email, verificationResult({
            clinicName: clinic.name, approved: dto.verification === 'VERIFIED', note: dto.note ?? null,
            panelLink: `${this.config.webOrigin}/panel`,
          }), `verification:${id}:${dto.verification}:${Date.now()}`);
        }
      }
      return updated;
    });
  }
}
