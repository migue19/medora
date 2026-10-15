import {
  BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode,
  NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min,
  MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { DateTime } from 'luxon';
import { PrismaService, Tx } from '../prisma.service';
import { Roles, Staff, StaffContext, StaffGuard } from '../auth/guards';
import { lockDoctor } from '../appointments/appointments.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

class CreateServiceDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsInt() @Min(5) @Max(480) durationMinutes: number;
  @IsInt() @Min(0) @Max(99999999) priceCents: number;
}

class UpdateServiceDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsInt() @Min(5) @Max(480) durationMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(99999999) priceCents?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class DoctorDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) displayName: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) specialty: string;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(30)
  licenseNumber?: string | null;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000)
  bio?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() membershipId?: string | null;
  @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) serviceIds: string[];
}

class UpdateDoctorDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) displayName?: string;
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) specialty?: string;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(30)
  licenseNumber?: string | null;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000)
  bio?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() membershipId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) serviceIds?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}

class RuleDto {
  @IsInt() @Min(1) @Max(7) weekday: number;
  @IsInt() @Min(0) @Max(1435) startMinute: number;
  @IsInt() @Min(5) @Max(1440) endMinute: number;
}

class ScheduleDto {
  @IsArray() @ArrayMaxSize(70) @ValidateNested({ each: true }) @Type(() => RuleDto) rules: RuleDto[];
}

class TimeOffDto {
  @IsISO8601({ strict: true }) startsAt: string;
  @IsISO8601({ strict: true }) endsAt: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(200) reason: string;
}

class RangeDto {
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
}

export function validateRules(rules: RuleDto[]): void {
  for (const r of rules) {
    if (r.startMinute % 5 !== 0 || r.endMinute % 5 !== 0) {
      throw new BadRequestException('Los horarios deben ir en múltiplos de 5 minutos');
    }
    if (r.startMinute >= r.endMinute) throw new BadRequestException('La hora de fin debe ser mayor a la de inicio');
  }
  const sorted = [...rules].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.weekday === cur.weekday && cur.startMinute < prev.endMinute) {
      throw new BadRequestException('Hay bloques de horario que se traslapan el mismo día');
    }
  }
}

@Controller('api/clinic')
@UseGuards(StaffGuard)
export class SchedulingController {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------- Servicios
  @Get('services')
  async services(@Staff() staff: StaffContext) {
    return this.prisma.service.findMany({ where: { clinicId: staff.clinicId }, orderBy: { name: 'asc' } });
  }

  @Post('services')
  @Roles('OWNER', 'ADMIN')
  async createService(@Staff() staff: StaffContext, @Body() dto: CreateServiceDto) {
    if (dto.durationMinutes % 5 !== 0) throw new BadRequestException('La duración debe ser múltiplo de 5 minutos');
    return this.uniqueName(() => this.prisma.service.create({ data: { ...dto, clinicId: staff.clinicId } }));
  }

  @Patch('services/:id')
  @Roles('OWNER', 'ADMIN')
  async updateService(
    @Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateServiceDto,
  ) {
    if (dto.durationMinutes !== undefined && dto.durationMinutes % 5 !== 0) {
      throw new BadRequestException('La duración debe ser múltiplo de 5 minutos');
    }
    const existing = await this.prisma.service.findFirst({ where: { id, clinicId: staff.clinicId } });
    if (!existing) throw new NotFoundException('Servicio no encontrado');
    // Las citas ya agendadas conservan su duración y precio originales.
    return this.uniqueName(() => this.prisma.service.update({ where: { id }, data: dto }));
  }

  // --------------------------------------------------------------- Médicos
  @Get('doctors')
  async doctors(@Staff() staff: StaffContext) {
    const rows = await this.prisma.doctor.findMany({
      where: { clinicId: staff.clinicId },
      include: {
        services: { select: { serviceId: true } },
        membership: { select: { id: true, user: { select: { name: true, email: true } } } },
        scheduleRules: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] },
      },
      orderBy: { displayName: 'asc' },
    });
    return rows.map((d) => ({
      id: d.id, displayName: d.displayName, specialty: d.specialty, licenseNumber: d.licenseNumber, bio: d.bio,
      active: d.active, membership: d.membership,
      serviceIds: d.services.map((s) => s.serviceId),
      rules: d.scheduleRules.map(({ weekday, startMinute, endMinute }) => ({ weekday, startMinute, endMinute })),
    }));
  }

  @Post('doctors')
  @Roles('OWNER', 'ADMIN')
  async createDoctor(@Staff() staff: StaffContext, @Body() dto: DoctorDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertDoctorLinks(tx, staff.clinicId, dto.membershipId ?? null, dto.serviceIds, null);
      const doctor = await tx.doctor.create({
        data: {
          clinicId: staff.clinicId, displayName: dto.displayName, specialty: dto.specialty,
          licenseNumber: dto.licenseNumber ?? null, bio: dto.bio ?? null, membershipId: dto.membershipId ?? null,
        },
      });
      if (dto.serviceIds.length) {
        await tx.doctorService.createMany({
          data: [...new Set(dto.serviceIds)].map((serviceId) => ({
            doctorId: doctor.id, serviceId, clinicId: staff.clinicId,
          })),
        });
      }
      return doctor;
    });
  }

  @Patch('doctors/:id')
  @Roles('OWNER', 'ADMIN')
  async updateDoctor(
    @Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDoctorDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const doctor = await tx.doctor.findFirst({ where: { id, clinicId: staff.clinicId } });
      if (!doctor) throw new NotFoundException('Médico no encontrado');
      await this.assertDoctorLinks(
        tx, staff.clinicId, dto.membershipId === undefined ? null : dto.membershipId, dto.serviceIds ?? [], id,
      );
      const { serviceIds, ...data } = dto;
      const updated = await tx.doctor.update({ where: { id }, data });
      if (serviceIds) {
        await tx.doctorService.deleteMany({ where: { doctorId: id } });
        if (serviceIds.length) {
          await tx.doctorService.createMany({
            data: [...new Set(serviceIds)].map((serviceId) => ({ doctorId: id, serviceId, clinicId: staff.clinicId })),
          });
        }
      }
      return updated;
    });
  }

  private async assertDoctorLinks(
    tx: Tx, clinicId: string, membershipId: string | null, serviceIds: string[], doctorId: string | null,
  ) {
    if (membershipId) {
      const m = await tx.membership.findFirst({
        where: { id: membershipId, clinicId }, include: { doctor: { select: { id: true } } },
      });
      if (!m) throw new NotFoundException('Integrante no encontrado');
      if (m.role !== 'DOCTOR') throw new BadRequestException('Sólo se puede vincular un integrante con rol DOCTOR');
      if (m.doctor && m.doctor.id !== doctorId) throw new ConflictException('Ese integrante ya tiene un perfil de médico');
    }
    const unique = [...new Set(serviceIds)];
    if (unique.length) {
      const count = await tx.service.count({ where: { id: { in: unique }, clinicId } });
      if (count !== unique.length) throw new NotFoundException('Algún servicio no existe en esta clínica');
    }
  }

  // ------------------------------------------------------- Horario semanal
  @Put('doctors/:id/schedule')
  @Roles('OWNER', 'ADMIN', 'DOCTOR')
  async putSchedule(
    @Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ScheduleDto,
  ) {
    this.assertOwnDoctor(staff, id);
    validateRules(dto.rules);
    return this.prisma.$transaction(async (tx) => {
      const doctor = await tx.doctor.findFirst({ where: { id, clinicId: staff.clinicId } });
      if (!doctor) throw new NotFoundException('Médico no encontrado');
      await lockDoctor(tx, id);
      // Las citas ya agendadas se conservan aunque queden fuera del nuevo horario.
      await tx.scheduleRule.deleteMany({ where: { doctorId: id } });
      if (dto.rules.length) {
        await tx.scheduleRule.createMany({
          data: dto.rules.map((r) => ({ ...r, doctorId: id, clinicId: staff.clinicId })),
        });
      }
      return tx.scheduleRule.findMany({
        where: { doctorId: id },
        select: { weekday: true, startMinute: true, endMinute: true },
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      });
    });
  }

  // ------------------------------------------------------------- Bloqueos
  @Get('doctors/:id/time-off')
  async timeOff(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: RangeDto) {
    const from = q.from ? new Date(q.from) : DateTime.now().minus({ days: 1 }).toJSDate();
    return this.prisma.timeOff.findMany({
      where: { doctorId: id, clinicId: staff.clinicId, endsAt: { gt: from } },
      orderBy: { startsAt: 'asc' },
      take: 200,
    });
  }

  @Post('doctors/:id/time-off')
  @Roles('OWNER', 'ADMIN', 'RECEPTION', 'DOCTOR')
  async createTimeOff(
    @Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TimeOffDto,
  ) {
    this.assertOwnDoctor(staff, id);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (!(endsAt > startsAt)) throw new BadRequestException('El fin debe ser posterior al inicio');
    if (endsAt.getTime() - startsAt.getTime() > 366 * 24 * 3600_000) {
      throw new BadRequestException('El bloqueo no puede durar más de un año');
    }
    if (endsAt <= new Date()) throw new BadRequestException('El bloqueo debe terminar en el futuro');
    return this.prisma.$transaction(async (tx) => {
      const doctor = await tx.doctor.findFirst({ where: { id, clinicId: staff.clinicId } });
      if (!doctor) throw new NotFoundException('Médico no encontrado');
      await lockDoctor(tx, id);
      const conflicts = await tx.appointment.count({
        where: { doctorId: id, status: 'BOOKED', startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
      });
      if (conflicts > 0) {
        throw new ConflictException(
          `Hay ${conflicts} cita(s) agendada(s) en ese periodo. Reprográmalas o cancélalas antes de bloquear.`,
        );
      }
      return tx.timeOff.create({
        data: { doctorId: id, clinicId: staff.clinicId, startsAt, endsAt, reason: dto.reason, createdById: staff.userId },
      });
    });
  }

  @Delete('doctors/:id/time-off/:timeOffId')
  @Roles('OWNER', 'ADMIN', 'RECEPTION', 'DOCTOR')
  @HttpCode(204)
  async deleteTimeOff(
    @Staff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('timeOffId', ParseUUIDPipe) timeOffId: string,
  ) {
    this.assertOwnDoctor(staff, id);
    const result = await this.prisma.timeOff.deleteMany({
      where: { id: timeOffId, doctorId: id, clinicId: staff.clinicId },
    });
    if (result.count === 0) throw new NotFoundException('Bloqueo no encontrado');
  }

  private assertOwnDoctor(staff: StaffContext, doctorId: string) {
    if (staff.role === 'DOCTOR' && staff.doctorId !== doctorId) {
      throw new ForbiddenException('Sólo puedes modificar tu propia agenda');
    }
  }

  private async uniqueName<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe un servicio con ese nombre');
      }
      throw e;
    }
  }
}
