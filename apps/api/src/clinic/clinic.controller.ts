import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException,
  Param, ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { PaymentMode, StaffInvitation, StaffRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength,
  Min, MinLength, ValidateIf,
} from 'class-validator';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService, Tx } from '../prisma.service';
import { randomToken, sha256 } from '../common/crypto';
import { normalizeEmail } from '../common/http';
import { MailService } from '../mail/mail.service';
import { Roles, Staff, StaffContext, StaffGuard } from '../auth/guards';
import { PHONE_PATTERN } from '../patient/patient-auth.controller';
import { assertFeature } from '../billing/plans';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

class UpdateClinicDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null)
  @IsString() @Matches(PHONE_PATTERN, { message: 'Teléfono inválido' }) phone?: string | null;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null)
  @IsString() @MaxLength(240) address?: string | null;
  @IsOptional() @IsBoolean() bookingEnabled?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10080) minNoticeMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) horizonDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10080) patientCancelMinMinutes?: number;
  @IsOptional() @IsBoolean() remindersEnabled?: boolean;
  /** Minutos antes de la cita: hasta 3, entre 30 min y 7 días. */
  @IsOptional() @IsArray() @ArrayMaxSize(3) @ArrayUnique() @IsInt({ each: true }) @Min(30, { each: true })
  @Max(10080, { each: true }) reminderOffsets?: number[];
  @IsOptional() @IsBoolean() whatsappEnabled?: boolean;
  @IsOptional() @IsBoolean() reviewsEnabled?: boolean;
  /** Aparecer en el directorio público de Medora. */
  @IsOptional() @IsBoolean() directoryEnabled?: boolean;
  /** Resumen semanal de indicadores por correo. */
  @IsOptional() @IsBoolean() weeklyReport?: boolean;
  @IsOptional() @IsEnum(PaymentMode) paymentMode?: PaymentMode;
  @IsOptional() @IsInt() @Min(10) @Max(100) depositPercent?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10080) refundMinMinutes?: number;
  @IsOptional() @IsBoolean() asyncPaymentsEnabled?: boolean;
}

class InviteDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsEmail() @MaxLength(254) email: string;
  @IsEnum(StaffRole) role: StaffRole;
}

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60_000;

function serializeInvitation(i: StaffInvitation) {
  return {
    id: i.id, name: i.name, email: i.email, role: i.role, createdAt: i.createdAt, expiresAt: i.expiresAt,
    expired: i.expiresAt <= new Date(),
  };
}

class UpdateMemberDto {
  @IsOptional() @IsEnum(StaffRole) role?: StaffRole;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** Roles que cada rol administrativo puede asignar o modificar. */
function manageableRoles(actor: StaffRole): StaffRole[] {
  if (actor === 'OWNER') return ['ADMIN', 'RECEPTION', 'DOCTOR'];
  if (actor === 'ADMIN') return ['RECEPTION', 'DOCTOR'];
  return [];
}

@Controller('api/clinic')
@UseGuards(StaffGuard)
export class ClinicController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  @Get()
  async get(@Staff() staff: StaffContext) {
    const clinic = await this.prisma.clinic.findUniqueOrThrow({ where: { id: staff.clinicId } });
    return { ...clinic, whatsappAvailable: this.config.whatsapp !== null, paymentsAvailable: this.config.payments !== null };
  }

  @Patch()
  @Roles('OWNER', 'ADMIN')
  async update(@Staff() staff: StaffContext, @Body() dto: UpdateClinicDto) {
    if (Object.keys(dto).length === 0) throw new BadRequestException('Sin cambios');
    const current = await this.prisma.clinic.findUniqueOrThrow({ where: { id: staff.clinicId } });
    if (dto.whatsappEnabled) assertFeature(current, 'whatsapp');
    if (dto.paymentMode && dto.paymentMode !== 'OFF') {
      assertFeature(current, 'payments');
      if (current.verification !== 'VERIFIED') throw new ConflictException('Podrás cobrar en línea en cuanto verifiquemos la cédula del médico responsable');
    }
    if (dto.directoryEnabled && current.verification !== 'VERIFIED') {
      throw new ConflictException('Podrás aparecer en el directorio en cuanto verifiquemos la cédula del médico responsable');
    }
    if (dto.paymentMode && dto.paymentMode !== 'OFF' && !this.config.payments) {
      throw new ConflictException('Los pagos en línea aún no están configurados en Medora');
    }
    const data = dto.reminderOffsets ? { ...dto, reminderOffsets: [...dto.reminderOffsets].sort((a, b) => b - a) } : dto;
    const clinic = await this.prisma.clinic.update({ where: { id: staff.clinicId }, data });
    return { ...clinic, whatsappAvailable: this.config.whatsapp !== null, paymentsAvailable: this.config.payments !== null };
  }

  // ---------------------------------------------------------------- Equipo
  @Get('members')
  @Roles('OWNER', 'ADMIN')
  async members(@Staff() staff: StaffContext) {
    const rows = await this.prisma.membership.findMany({
      where: { clinicId: staff.clinicId },
      include: { user: true, doctor: { select: { id: true, displayName: true } } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((m) => ({
      id: m.id, role: m.role, active: m.active, createdAt: m.createdAt, clinicalAccess: m.clinicalAccess,
      user: { id: m.user.id, name: m.user.name, email: m.user.email },
      doctor: m.doctor,
    }));
  }

  // ---------------------------------------------------------- Invitaciones
  @Get('invitations')
  @Roles('OWNER', 'ADMIN')
  async invitations(@Staff() staff: StaffContext) {
    const rows = await this.prisma.staffInvitation.findMany({
      where: { clinicId: staff.clinicId, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(serializeInvitation);
  }

  /** Invita por correo. Una invitación pendiente anterior al mismo correo se reemplaza. */
  @Post('invitations')
  @Roles('OWNER', 'ADMIN')
  async invite(@Staff() staff: StaffContext, @Body() dto: InviteDto) {
    if (!manageableRoles(staff.role).includes(dto.role)) {
      throw new ForbiddenException('No puedes asignar ese rol');
    }
    const email = normalizeEmail(dto.email);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Clinic" WHERE id = ${staff.clinicId}::uuid FOR UPDATE`;
      const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: staff.clinicId } });
      const member = await tx.membership.findFirst({ where: { clinicId: staff.clinicId, user: { email } } });
      if (member) throw new ConflictException('Esa persona ya es parte del equipo');
      await tx.staffInvitation.updateMany({
        where: { clinicId: staff.clinicId, email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const token = randomToken();
      const invitation = await tx.staffInvitation.create({
        data: {
          clinicId: staff.clinicId, email, name: dto.name, role: dto.role, tokenHash: sha256(token),
          invitedById: staff.userId, expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        },
      });
      await this.mail.staffInvitation(tx, {
        email, name: dto.name, clinicName: clinic.name, timezone: clinic.timezone, role: dto.role,
        inviterName: staff.name, token, expiresAt: invitation.expiresAt,
      });
      return serializeInvitation(invitation);
    });
  }

  /** Reenvía con un enlace nuevo; el anterior deja de servir. */
  @Post('invitations/:id/resend')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(200)
  async resendInvitation(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.pendingInvitation(tx, staff, id);
      const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: staff.clinicId } });
      const token = randomToken();
      const invitation = await tx.staffInvitation.update({
        where: { id: current.id },
        data: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITATION_TTL_MS) },
      });
      await this.mail.staffInvitation(tx, {
        email: invitation.email, name: invitation.name, clinicName: clinic.name, timezone: clinic.timezone,
        role: invitation.role, inviterName: staff.name, token, expiresAt: invitation.expiresAt,
      });
      return serializeInvitation(invitation);
    });
  }

  @Post('invitations/:id/revoke')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(204)
  async revokeInvitation(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.pendingInvitation(tx, staff, id);
      await tx.staffInvitation.update({ where: { id: current.id }, data: { revokedAt: new Date() } });
    });
  }

  private async pendingInvitation(tx: Tx, staff: StaffContext, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "StaffInvitation" WHERE id = ${id}::uuid AND "clinicId" = ${staff.clinicId}::uuid FOR UPDATE`;
    const invitation = rows.length
      ? await tx.staffInvitation.findUnique({ where: { id: rows[0].id } })
      : null;
    if (!invitation || invitation.acceptedAt || invitation.revokedAt) {
      throw new NotFoundException('Invitación no encontrada');
    }
    if (!manageableRoles(staff.role).includes(invitation.role)) {
      throw new ForbiddenException('No puedes modificar esta invitación');
    }
    return invitation;
  }

  @Patch('members/:id')
  @Roles('OWNER', 'ADMIN')
  async updateMember(
    @Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMemberDto,
  ) {
    if (dto.role === undefined && dto.active === undefined) throw new BadRequestException('Sin cambios');
    if (id === staff.membershipId) throw new ForbiddenException('No puedes modificar tu propia membresía');
    const allowed = manageableRoles(staff.role);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Clinic" WHERE id = ${staff.clinicId}::uuid FOR UPDATE`;
      const target = await tx.membership.findFirst({
        where: { id, clinicId: staff.clinicId }, include: { doctor: true },
      });
      if (!target) throw new NotFoundException('Integrante no encontrado');
      if (!allowed.includes(target.role)) throw new ForbiddenException('No puedes modificar a este integrante');
      if (dto.role && !allowed.includes(dto.role)) throw new ForbiddenException('No puedes asignar ese rol');
      if (dto.role === 'RECEPTION' && target.doctor) {
        throw new ConflictException('Desvincula primero el perfil de médico');
      }
      const updated = await tx.membership.update({
        where: { id }, data: { role: dto.role, active: dto.active }, include: { user: true },
      });
      // Cambiar rol o estado revoca las sesiones de esa membresía.
      await tx.refreshSession.updateMany({
        where: { membershipId: id, revokedAt: null }, data: { revokedAt: new Date() },
      });
      return {
        id: updated.id, role: updated.role, active: updated.active,
        user: { id: updated.user.id, name: updated.user.name, email: updated.user.email },
      };
    });
  }
}
