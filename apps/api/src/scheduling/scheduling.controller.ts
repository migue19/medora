import {
  BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpCode,
  NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma, VisitType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
  MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { defaultLocation, withinHours } from '../locations/locations.controller';
import { SLUG_PATTERN, slugify, uniqueDoctorSlug } from '../common/slug';
import { DateTime } from 'luxon';
import { PrismaService, Tx } from '../prisma.service';
import { Roles, Staff, StaffContext, StaffGuard } from '../auth/guards';
import { lockDoctor } from '../appointments/appointments.service';
import { assertDoctorSlot, assertFeature } from '../billing/plans';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

class CreateServiceDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsInt() @Min(5) @Max(480) durationMinutes: number;
  @IsInt() @Min(0) @Max(99999999) priceCents: number;
  @IsOptional() @IsEnum(VisitType) visitType?: VisitType;
  /** También se ofrece por videoconsulta (filtro del directorio). */
  @IsOptional() @IsBoolean() telemedicine?: boolean;
}

class PriceDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() doctorId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() locationId?: string | null;
  @IsInt() @Min(0) @Max(99999999) priceCents: number;
}

class PricesDto {
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PriceDto) prices: PriceDto[];
}

/** Listas del perfil profesional: elementos sin espacios sobrantes, sin repetir, de hasta 120 caracteres. */
const cleanList = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? [...new Set(value.map((v) => (typeof v === 'string' ? v.trim() : v)).filter((v) => v !== ''))]
    : value;

class ProfileFields {
  @IsOptional() @Transform(cleanList) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(120, { each: true }) education?: string[];
  @IsOptional() @Transform(cleanList) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(120, { each: true }) certifications?: string[];
  @IsOptional() @Transform(cleanList) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(120, { each: true }) languages?: string[];
  @IsOptional() @Transform(cleanList) @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) @MaxLength(120, { each: true }) conditions?: string[];
  @IsOptional() @Transform(cleanList) @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) @MaxLength(120, { each: true }) insurers?: string[];
}

class UpdateServiceDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsInt() @Min(5) @Max(480) durationMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(99999999) priceCents?: number;
  @IsOptional() @IsEnum(VisitType) visitType?: VisitType;
  @IsOptional() @IsBoolean() telemedicine?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}

const SLUG_MESSAGE = 'El identificador sólo admite minúsculas, números y guiones';

class DoctorDto extends ProfileFields {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) displayName: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE }) slug?: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) specialty: string;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(30)
  licenseNumber?: string | null;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000)
  bio?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() membershipId?: string | null;
  @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) serviceIds: string[];
}

class UpdateDoctorDto extends ProfileFields {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) displayName?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) @Matches(SLUG_PATTERN, { message: SLUG_MESSAGE }) slug?: string;
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
  /** Sede del bloque; si se omite, la sede por omisión de la clínica. */
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() roomId?: string | null;
}

const PHOTO_TYPES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};
export const MAX_PHOTO_BYTES = 900 * 1024;

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
    if (dto.telemedicine) assertFeature(await this.prisma.clinic.findUniqueOrThrow({ where: { id: staff.clinicId } }), 'telemedicine');
    return this.uniqueName(() => this.prisma.service.create({ data: { ...dto, clinicId: staff.clinicId } }));
  }

  @Patch('services/:id')
  @Roles('OWNER', 'ADMIN')
  async updateService(
    @Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateServiceDto,
  ) {
    if (dto.telemedicine) assertFeature(await this.prisma.clinic.findUniqueOrThrow({ where: { id: staff.clinicId } }), 'telemedicine');
    if (dto.durationMinutes !== undefined && dto.durationMinutes % 5 !== 0) {
      throw new BadRequestException('La duración debe ser múltiplo de 5 minutos');
    }
    const existing = await this.prisma.service.findFirst({ where: { id, clinicId: staff.clinicId } });
    if (!existing) throw new NotFoundException('Servicio no encontrado');
    // Las citas ya agendadas conservan su duración y precio originales.
    return this.uniqueName(() => this.prisma.service.update({ where: { id }, data: dto }));
  }

  /** Precios especiales del servicio por sede, por médico o por médico en una sede. */
  @Get('services/:id/prices')
  async prices(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    const service = await this.prisma.service.findFirst({ where: { id, clinicId: staff.clinicId } });
    if (!service) throw new NotFoundException('Servicio no encontrado');
    return this.prisma.servicePrice.findMany({
      where: { serviceId: id }, select: { doctorId: true, locationId: true, priceCents: true },
    });
  }

  @Put('services/:id/prices')
  @Roles('OWNER', 'ADMIN')
  async putPrices(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PricesDto) {
    const service = await this.prisma.service.findFirst({ where: { id, clinicId: staff.clinicId } });
    if (!service) throw new NotFoundException('Servicio no encontrado');
    const keys = new Set<string>();
    for (const p of dto.prices) {
      if (!p.doctorId && !p.locationId) throw new BadRequestException('Cada precio especial necesita sede, médico o ambos');
      const key = `${p.doctorId ?? ''}|${p.locationId ?? ''}`;
      if (keys.has(key)) throw new BadRequestException('Hay precios repetidos para la misma combinación');
      keys.add(key);
    }
    const doctorIds = [...new Set(dto.prices.flatMap((p) => (p.doctorId ? [p.doctorId] : [])))];
    const locationIds = [...new Set(dto.prices.flatMap((p) => (p.locationId ? [p.locationId] : [])))];
    const [doctors, locations] = await Promise.all([
      this.prisma.doctor.count({ where: { id: { in: doctorIds }, clinicId: staff.clinicId } }),
      this.prisma.location.count({ where: { id: { in: locationIds }, clinicId: staff.clinicId } }),
    ]);
    if (doctors !== doctorIds.length || locations !== locationIds.length) throw new NotFoundException('Médico o sede no encontrados');
    // Las citas ya agendadas conservan el precio con que se reservaron.
    return this.prisma.$transaction(async (tx) => {
      await tx.servicePrice.deleteMany({ where: { serviceId: id } });
      if (dto.prices.length) {
        await tx.servicePrice.createMany({
          data: dto.prices.map((p) => ({
            clinicId: staff.clinicId, serviceId: id, doctorId: p.doctorId ?? null, locationId: p.locationId ?? null,
            priceCents: p.priceCents,
          })),
        });
      }
      return tx.servicePrice.findMany({ where: { serviceId: id }, select: { doctorId: true, locationId: true, priceCents: true } });
    });
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
        photo: { select: { updatedAt: true } },
      },
      orderBy: { displayName: 'asc' },
    });
    return rows.map((d) => ({
      id: d.id, displayName: d.displayName, slug: d.slug, specialty: d.specialty, licenseNumber: d.licenseNumber, bio: d.bio,
      education: d.education, certifications: d.certifications, languages: d.languages, conditions: d.conditions,
      insurers: d.insurers, inCatalog: d.specialtyId !== null,
      active: d.active, membership: d.membership,
      photoUrl: d.photo ? `/api/public/doctors/${d.id}/photo?v=${d.photo.updatedAt.getTime()}` : null,
      serviceIds: d.services.map((s) => s.serviceId),
      rules: d.scheduleRules.map(({ weekday, startMinute, endMinute, locationId, roomId }) => ({
        weekday, startMinute, endMinute, locationId, roomId,
      })),
    }));
  }

  @Post('doctors')
  @Roles('OWNER', 'ADMIN')
  async createDoctor(@Staff() staff: StaffContext, @Body() dto: DoctorDto) {
    return this.uniqueSlug(() => this.prisma.$transaction(async (tx) => {
      await this.assertDoctorLinks(tx, staff.clinicId, dto.membershipId ?? null, dto.serviceIds, null);
      await assertDoctorSlot(tx, staff.clinicId);
      const doctor = await tx.doctor.create({
        data: {
          clinicId: staff.clinicId, displayName: dto.displayName, specialty: dto.specialty,
          slug: dto.slug ?? (await uniqueDoctorSlug(tx, staff.clinicId, slugify(dto.displayName))),
          licenseNumber: dto.licenseNumber ?? null, bio: dto.bio ?? null, membershipId: dto.membershipId ?? null,
          education: dto.education ?? [], certifications: dto.certifications ?? [], languages: dto.languages ?? [],
          conditions: dto.conditions ?? [], insurers: dto.insurers ?? [],
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
    }));
  }

  @Patch('doctors/:id')
  @Roles('OWNER', 'ADMIN')
  async updateDoctor(
    @Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDoctorDto,
  ) {
    return this.uniqueSlug(() => this.prisma.$transaction(async (tx) => {
      const doctor = await tx.doctor.findFirst({ where: { id, clinicId: staff.clinicId } });
      if (!doctor) throw new NotFoundException('Médico no encontrado');
      if (dto.active === true && !doctor.active) await assertDoctorSlot(tx, staff.clinicId, id);
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
    }));
  }

  private async assertDoctorLinks(
    tx: Tx, clinicId: string, membershipId: string | null, serviceIds: string[], doctorId: string | null,
  ) {
    if (membershipId) {
      const m = await tx.membership.findFirst({
        where: { id: membershipId, clinicId }, include: { doctor: { select: { id: true } } },
      });
      if (!m) throw new NotFoundException('Integrante no encontrado');
      // El propietario o la administración también pueden ser médicos (consultorios pequeños); recepción no.
      if (m.role === 'RECEPTION') throw new BadRequestException('Recepción no puede tener un perfil de médico');
      if (m.doctor && m.doctor.id !== doctorId) throw new ConflictException('Ese integrante ya tiene un perfil de médico');
    }
    const unique = [...new Set(serviceIds)];
    if (unique.length) {
      const count = await tx.service.count({ where: { id: { in: unique }, clinicId } });
      if (count !== unique.length) throw new NotFoundException('Algún servicio no existe en esta clínica');
    }
  }

  /** Foto del médico. La web la reduce antes de subirla; aquí sólo se valida tipo real y tamaño. */
  @Post('doctors/:id/photo')
  @Roles('OWNER', 'ADMIN', 'DOCTOR')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  async uploadPhoto(
    @Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined,
  ) {
    this.assertOwnDoctor(staff, id);
    const doctor = await this.prisma.doctor.findFirst({ where: { id, clinicId: staff.clinicId } });
    if (!doctor) throw new NotFoundException('Médico no encontrado');
    if (!file?.buffer?.length) throw new BadRequestException('Falta la imagen');
    const type = Object.keys(PHOTO_TYPES).find((t) => PHOTO_TYPES[t](file.buffer));
    if (!type) throw new BadRequestException('La foto debe ser JPEG, PNG o WebP');
    const data = new Uint8Array(file.buffer);
    const photo = await this.prisma.doctorPhoto.upsert({
      where: { doctorId: id },
      create: { doctorId: id, mimeType: type, data },
      update: { mimeType: type, data },
    });
    return { photoUrl: `/api/public/doctors/${id}/photo?v=${photo.updatedAt.getTime()}` };
  }

  @Delete('doctors/:id/photo')
  @Roles('OWNER', 'ADMIN', 'DOCTOR')
  @HttpCode(204)
  async deletePhoto(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    this.assertOwnDoctor(staff, id);
    const doctor = await this.prisma.doctor.findFirst({ where: { id, clinicId: staff.clinicId } });
    if (!doctor) throw new NotFoundException('Médico no encontrado');
    await this.prisma.doctorPhoto.deleteMany({ where: { doctorId: id } });
  }

  // ------------------------------------------------------- Horario semanal
  @Put('doctors/:id/schedule')
  @Roles('OWNER', 'ADMIN', 'DOCTOR')
  async putSchedule(
    @Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ScheduleDto,
  ) {
    this.assertOwnDoctor(staff, id);
    validateRules(dto.rules);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const doctor = await tx.doctor.findFirst({ where: { id, clinicId: staff.clinicId } });
        if (!doctor) throw new NotFoundException('Médico no encontrado');
        await lockDoctor(tx, id);
        const fallback = dto.rules.some((r) => !r.locationId) ? await defaultLocation(tx, staff.clinicId) : null;
        const rules = dto.rules.map((r) => ({ ...r, locationId: r.locationId ?? fallback!.id, roomId: r.roomId ?? null }));
        const locations = await tx.location.findMany({
          where: { id: { in: [...new Set(rules.map((r) => r.locationId))] }, clinicId: staff.clinicId, active: true },
          include: { hours: true },
        });
        const rooms = await tx.room.findMany({
          where: { id: { in: rules.flatMap((r) => (r.roomId ? [r.roomId] : [])) }, clinicId: staff.clinicId, active: true },
        });
        for (const r of rules) {
          const location = locations.find((l) => l.id === r.locationId);
          if (!location) throw new NotFoundException('Sede no encontrada o inactiva');
          if (r.roomId && rooms.find((x) => x.id === r.roomId)?.locationId !== r.locationId) {
            throw new BadRequestException('El consultorio no pertenece a la sede del bloque');
          }
          if (location.hours.length && !withinHours(r, location.hours)) {
            throw new BadRequestException(`Un bloque queda fuera del horario de atención de «${location.name}»`);
          }
        }
        // Las citas ya agendadas se conservan aunque queden fuera del nuevo horario.
        await tx.scheduleRule.deleteMany({ where: { doctorId: id } });
        if (rules.length) {
          await tx.scheduleRule.createMany({ data: rules.map((r) => ({ ...r, doctorId: id, clinicId: staff.clinicId })) });
        }
        return tx.scheduleRule.findMany({
          where: { doctorId: id },
          select: { weekday: true, startMinute: true, endMinute: true, locationId: true, roomId: true },
          orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
        });
      });
    } catch (e) {
      if (String((e as { message?: string }).message).includes('ScheduleRule_room_no_overlap')) {
        throw new ConflictException('Ese consultorio ya está asignado a otro médico en ese día y horario');
      }
      throw e;
    }
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
        where: { doctorId: id, status: { in: ['BOOKED', 'PENDING_PAYMENT'] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
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

  private async uniqueSlug<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ese identificador de URL ya lo usa otro médico de la clínica');
      }
      throw e;
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
