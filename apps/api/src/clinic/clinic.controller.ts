import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param,
  ParseUUIDPipe, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { Prisma, StaffRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';
import { PrismaService } from '../prisma.service';
import { hashPassword } from '../common/crypto';
import { normalizeEmail } from '../common/http';
import { Roles, Staff, StaffContext, StaffGuard } from '../auth/guards';
import { PHONE_PATTERN } from '../patient/patient-auth.controller';

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
}

class CreateMemberDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(12) @MaxLength(200) password: string;
  @IsEnum(StaffRole) role: StaffRole;
}

class UpdateMemberDto {
  @IsOptional() @IsEnum(StaffRole) role?: StaffRole;
  @IsOptional() @IsBoolean() active?: boolean;
}

class PatientSearchDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) q?: string;
}

class CreateClinicPatientDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @Transform(trim) @IsString() @Matches(PHONE_PATTERN, { message: 'Teléfono inválido' }) phone: string;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsEmail() @MaxLength(254)
  email?: string | null;
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
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@Staff() staff: StaffContext) {
    return this.prisma.clinic.findUniqueOrThrow({ where: { id: staff.clinicId } });
  }

  @Patch()
  @Roles('OWNER', 'ADMIN')
  async update(@Staff() staff: StaffContext, @Body() dto: UpdateClinicDto) {
    if (Object.keys(dto).length === 0) throw new BadRequestException('Sin cambios');
    return this.prisma.clinic.update({ where: { id: staff.clinicId }, data: dto });
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
      id: m.id, role: m.role, active: m.active, createdAt: m.createdAt,
      user: { id: m.user.id, name: m.user.name, email: m.user.email },
      doctor: m.doctor,
    }));
  }

  @Post('members')
  @Roles('OWNER', 'ADMIN')
  async createMember(@Staff() staff: StaffContext, @Body() dto: CreateMemberDto) {
    if (!manageableRoles(staff.role).includes(dto.role)) {
      throw new ForbiddenException('No puedes asignar ese rol');
    }
    const passwordHash = await hashPassword(dto.password);
    try {
      const m = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email: normalizeEmail(dto.email), name: dto.name, passwordHash },
        });
        return tx.membership.create({
          data: { userId: user.id, clinicId: staff.clinicId, role: dto.role },
          include: { user: true },
        });
      });
      return {
        id: m.id, role: m.role, active: m.active, createdAt: m.createdAt,
        user: { id: m.user.id, name: m.user.name, email: m.user.email }, doctor: null,
      };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ese correo ya está registrado');
      }
      throw e;
    }
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
      if (dto.role && dto.role !== 'DOCTOR' && target.doctor) {
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

  // ------------------------------------------------------------- Pacientes
  @Get('patients')
  @Roles('OWNER', 'ADMIN', 'RECEPTION')
  async patients(@Staff() staff: StaffContext, @Query() query: PatientSearchDto) {
    const q = query.q?.trim();
    return this.prisma.clinicPatient.findMany({
      where: {
        clinicId: staff.clinicId,
        ...(q ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        } : {}),
      },
      select: { id: true, name: true, phone: true, email: true, patientAccountId: true, createdAt: true },
      orderBy: { name: 'asc' },
      take: 50,
    });
  }

  @Post('patients')
  @Roles('OWNER', 'ADMIN', 'RECEPTION')
  async createPatient(@Staff() staff: StaffContext, @Body() dto: CreateClinicPatientDto) {
    return this.prisma.clinicPatient.create({
      data: {
        clinicId: staff.clinicId, name: dto.name, phone: dto.phone,
        email: dto.email ? normalizeEmail(dto.email) : null,
      },
      select: { id: true, name: true, phone: true, email: true, patientAccountId: true, createdAt: true },
    });
  }
}
