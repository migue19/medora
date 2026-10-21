import {
  BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post,
  Put, UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PrismaService, Tx } from '../prisma.service';
import { Roles, Staff, StaffContext, StaffGuard } from '../auth/guards';
import { PHONE_PATTERN } from '../patient/patient-auth.controller';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

class LocationDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(240) address?: string | null;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null)
  @IsString() @Matches(PHONE_PATTERN, { message: 'Teléfono inválido' }) phone?: string | null;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null)
  @IsString() @MaxLength(500) @Matches(/^https:\/\/\S+$/, { message: 'El enlace del mapa debe empezar con https://' })
  mapUrl?: string | null;
}

class UpdateLocationDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(240) address?: string | null;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null)
  @IsString() @Matches(PHONE_PATTERN, { message: 'Teléfono inválido' }) phone?: string | null;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null)
  @IsString() @MaxLength(500) @Matches(/^https:\/\/\S+$/, { message: 'El enlace del mapa debe empezar con https://' })
  mapUrl?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
}

class HoursRuleDto {
  @IsInt() @Min(1) @Max(7) weekday: number;
  @IsInt() @Min(0) @Max(1435) startMinute: number;
  @IsInt() @Min(5) @Max(1440) endMinute: number;
}

class HoursDto {
  @IsArray() @ArrayMaxSize(42) @ValidateNested({ each: true }) @Type(() => HoursRuleDto) hours: HoursRuleDto[];
}

class RoomDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(60) name: string;
}

class UpdateRoomDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** Sede por omisión: la primera activa; si la clínica no tiene ninguna, crea «Sede principal». */
export async function defaultLocation(tx: Tx | PrismaService, clinicId: string) {
  const existing = await tx.location.findFirst({ where: { clinicId, active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  if (existing) return existing;
  const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: clinicId } });
  return tx.location.create({ data: { clinicId, name: 'Sede principal', address: clinic.address, phone: clinic.phone } });
}

const INCLUDE = {
  hours: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] },
  rooms: { orderBy: { name: 'asc' } },
} satisfies Prisma.LocationInclude;

function serialize(l: Prisma.LocationGetPayload<{ include: typeof INCLUDE }>) {
  return {
    id: l.id, name: l.name, address: l.address, phone: l.phone, mapUrl: l.mapUrl, active: l.active, sortOrder: l.sortOrder,
    hours: l.hours.map(({ weekday, startMinute, endMinute }) => ({ weekday, startMinute, endMinute })),
    rooms: l.rooms.map(({ id, name, active }) => ({ id, name, active })),
  };
}

@Controller('api/clinic')
@UseGuards(StaffGuard)
export class LocationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('locations')
  async list(@Staff() staff: StaffContext) {
    await defaultLocation(this.prisma, staff.clinicId);
    const rows = await this.prisma.location.findMany({
      where: { clinicId: staff.clinicId }, include: INCLUDE, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(serialize);
  }

  @Post('locations')
  @Roles('OWNER', 'ADMIN')
  async create(@Staff() staff: StaffContext, @Body() dto: LocationDto) {
    return this.unique(async () => serialize(await this.prisma.location.create({
      data: { ...dto, clinicId: staff.clinicId }, include: INCLUDE,
    })));
  }

  @Patch('locations/:id')
  @Roles('OWNER', 'ADMIN')
  async update(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLocationDto) {
    await this.find(staff.clinicId, id);
    if (dto.active === false) {
      // Una sede con horarios o citas próximas no se puede desactivar.
      const [rules, upcoming] = await Promise.all([
        this.prisma.scheduleRule.count({ where: { locationId: id } }),
        this.prisma.appointment.count({ where: { locationId: id, status: 'BOOKED', startsAt: { gt: new Date() } } }),
      ]);
      if (rules || upcoming) {
        throw new ConflictException('La sede tiene horarios de médicos o citas próximas. Muévelos antes de desactivarla.');
      }
    }
    return this.unique(async () => serialize(await this.prisma.location.update({ where: { id }, data: dto, include: INCLUDE })));
  }

  /** Horario de atención de la sede. Los bloques de los médicos en la sede deben quedar dentro. */
  @Put('locations/:id/hours')
  @Roles('OWNER', 'ADMIN')
  async hours(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HoursDto) {
    await this.find(staff.clinicId, id);
    for (const h of dto.hours) {
      if (h.startMinute % 5 || h.endMinute % 5) throw new BadRequestException('Los horarios deben ir en múltiplos de 5 minutos');
      if (h.startMinute >= h.endMinute) throw new BadRequestException('La hora de fin debe ser mayor a la de inicio');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.locationHours.deleteMany({ where: { locationId: id } });
        if (dto.hours.length) await tx.locationHours.createMany({ data: dto.hours.map((h) => ({ ...h, locationId: id })) });
        const rules = await tx.scheduleRule.findMany({ where: { locationId: id }, include: { doctor: { select: { displayName: true } } } });
        const outside = rules.find((r) => !withinHours(r, dto.hours));
        if (outside && dto.hours.length) {
          throw new ConflictException(`El horario de ${outside.doctor.displayName} queda fuera del nuevo horario de la sede`);
        }
        return serialize(await tx.location.findUniqueOrThrow({ where: { id }, include: INCLUDE }));
      });
    } catch (e) {
      if (String((e as { message?: string }).message).includes('LocationHours_no_overlap')) {
        throw new BadRequestException('Hay bloques del horario de la sede que se traslapan el mismo día');
      }
      throw e;
    }
  }

  @Post('locations/:id/rooms')
  @Roles('OWNER', 'ADMIN')
  async addRoom(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoomDto) {
    await this.find(staff.clinicId, id);
    await this.unique(() => this.prisma.room.create({ data: { clinicId: staff.clinicId, locationId: id, name: dto.name } }));
    return serialize(await this.prisma.location.findUniqueOrThrow({ where: { id }, include: INCLUDE }));
  }

  @Patch('rooms/:id')
  @Roles('OWNER', 'ADMIN')
  async updateRoom(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoomDto) {
    const room = await this.prisma.room.findFirst({ where: { id, clinicId: staff.clinicId } });
    if (!room) throw new NotFoundException('Consultorio no encontrado');
    if (dto.active === false && (await this.prisma.scheduleRule.count({ where: { roomId: id } }))) {
      throw new ConflictException('El consultorio está asignado en horarios de médicos. Quítalo de esos horarios primero.');
    }
    await this.unique(() => this.prisma.room.update({ where: { id }, data: dto }));
    return serialize(await this.prisma.location.findUniqueOrThrow({ where: { id: room.locationId }, include: INCLUDE }));
  }

  private async find(clinicId: string, id: string) {
    const l = await this.prisma.location.findFirst({ where: { id, clinicId } });
    if (!l) throw new NotFoundException('Sede no encontrada');
    return l;
  }

  private async unique<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe uno con ese nombre');
      }
      throw e;
    }
  }
}

/** ¿El bloque cabe en alguno de los horarios de la sede ese día? */
export function withinHours(
  rule: { weekday: number; startMinute: number; endMinute: number },
  hours: { weekday: number; startMinute: number; endMinute: number }[],
): boolean {
  return hours.some((h) => h.weekday === rule.weekday && rule.startMinute >= h.startMinute && rule.endMinute <= h.endMinute);
}
