import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe,
  Post, Query, UseGuards,
} from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsIn, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';
import { PrismaService } from '../prisma.service';
import { Roles, Staff, StaffContext, StaffGuard } from '../auth/guards';
import { Actor, AppointmentsService } from './appointments.service';
import { parseLocalDate } from '../scheduling/availability';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

class ListDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(31) days?: number;
  @IsOptional() @IsUUID() doctorId?: string;
}

class AvailabilityDto {
  @IsUUID() serviceId: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(14) days?: number;
}

class StaffBookDto {
  @IsUUID() requestId: string;
  @IsUUID() doctorId: string;
  @IsUUID() serviceId: string;
  @IsUUID() clinicPatientId: string;
  @IsISO8601({ strict: true }) startsAt: string;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500)
  notes?: string | null;
}

class CancelDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(200) reason: string;
}

class RescheduleDto {
  @IsISO8601({ strict: true }) startsAt: string;
  @IsISO8601({ strict: true }) expectedStartsAt: string;
}

class OutcomeDto {
  @IsIn(['COMPLETED', 'NO_SHOW']) status: 'COMPLETED' | 'NO_SHOW';
  @IsIn(['BOOKED']) expectedStatus: 'BOOKED';
}

const actorOf = (s: StaffContext): Actor => ({ kind: 'STAFF', id: s.userId, name: s.name });

@Controller('api/clinic')
@UseGuards(StaffGuard)
export class StaffAppointmentsController {
  constructor(private readonly prisma: PrismaService, private readonly appointments: AppointmentsService) {}

  @Get('appointments')
  async list(@Staff() staff: StaffContext, @Query() q: ListDto) {
    const clinic = await this.prisma.clinic.findUniqueOrThrow({ where: { id: staff.clinicId } });
    const first = parseLocalDate(q.from, clinic.timezone);
    if (!first) throw new BadRequestException('Fecha inválida');
    const days = q.days ?? 1;
    let doctorId = q.doctorId;
    if (staff.role === 'DOCTOR') {
      if (!staff.doctorId) return { timezone: clinic.timezone, appointments: [] };
      if (doctorId && doctorId !== staff.doctorId) throw new ForbiddenException('Sólo puedes ver tu agenda');
      doctorId = staff.doctorId;
    }
    const rows = await this.prisma.appointment.findMany({
      where: {
        clinicId: staff.clinicId,
        ...(doctorId ? { doctorId } : {}),
        startsAt: { gte: first.toJSDate(), lt: first.plus({ days }).toJSDate() },
      },
      include: {
        doctor: { select: { id: true, displayName: true } },
        clinicPatient: { select: { id: true, name: true, phone: true, email: true } },
        notifications: NOTIFICATION_SELECT,
      },
      orderBy: [{ startsAt: 'asc' }],
      take: 1000,
    });
    return { timezone: clinic.timezone, appointments: rows.map(serialize) };
  }

  @Get('appointments/:id')
  async detail(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    const a = await this.findVisible(staff, id);
    const events = await this.prisma.appointmentEvent.findMany({
      where: { appointmentId: a.id }, orderBy: { createdAt: 'asc' },
    });
    const full = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: a.id },
      include: {
        doctor: { select: { id: true, displayName: true } },
        clinicPatient: { select: { id: true, name: true, phone: true, email: true } },
        notifications: NOTIFICATION_SELECT,
      },
    });
    return { ...serialize(full), events };
  }

  @Get('doctors/:doctorId/availability')
  async availability(
    @Staff() staff: StaffContext, @Param('doctorId', ParseUUIDPipe) doctorId: string, @Query() q: AvailabilityDto,
  ) {
    return this.appointments.availability({
      clinicId: staff.clinicId, doctorId, serviceId: q.serviceId, from: q.from, days: q.days ?? 7,
    });
  }

  @Post('appointments')
  @Roles('OWNER', 'ADMIN', 'RECEPTION')
  async book(@Staff() staff: StaffContext, @Body() dto: StaffBookDto) {
    const patient = await this.prisma.clinicPatient.findFirst({
      where: { id: dto.clinicPatientId, clinicId: staff.clinicId },
    });
    if (!patient) throw new NotFoundException('Paciente no encontrado');
    const { appointment } = await this.appointments.book({
      clinicId: staff.clinicId, doctorId: dto.doctorId, serviceId: dto.serviceId, clinicPatientId: patient.id,
      startsAt: new Date(dto.startsAt), notes: dto.notes ?? null, source: 'STAFF', requestId: dto.requestId,
      actor: actorOf(staff),
    });
    return appointment;
  }

  @Post('appointments/:id/cancel')
  @Roles('OWNER', 'ADMIN', 'RECEPTION', 'DOCTOR')
  @HttpCode(200)
  async cancel(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    const appointment = await this.findVisible(staff, id);
    return this.appointments.cancel({ appointment, reason: dto.reason, actor: actorOf(staff), minMinutesBefore: null });
  }

  @Post('appointments/:id/reschedule')
  @Roles('OWNER', 'ADMIN', 'RECEPTION')
  @HttpCode(200)
  async reschedule(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RescheduleDto) {
    const appointment = await this.findVisible(staff, id);
    return this.appointments.reschedule({
      appointment, startsAt: new Date(dto.startsAt), expectedStartsAt: new Date(dto.expectedStartsAt),
      actor: actorOf(staff), online: false,
    });
  }

  @Post('appointments/:id/outcome')
  @Roles('OWNER', 'ADMIN', 'RECEPTION', 'DOCTOR')
  @HttpCode(200)
  async outcome(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OutcomeDto) {
    const appointment = await this.findVisible(staff, id);
    return this.appointments.markOutcome({
      appointment, status: dto.status, expectedStatus: dto.expectedStatus, actor: actorOf(staff),
    });
  }

  private async findVisible(staff: StaffContext, id: string) {
    const a = await this.prisma.appointment.findFirst({ where: { id, clinicId: staff.clinicId } });
    if (!a) throw new NotFoundException('Cita no encontrada');
    if (staff.role === 'DOCTOR' && a.doctorId !== staff.doctorId) throw new NotFoundException('Cita no encontrada');
    return a;
  }
}

const NOTIFICATION_SELECT = {
  select: { channel: true, offsetMinutes: true, status: true, error: true, createdAt: true, startsAt: true },
  orderBy: { createdAt: 'asc' },
} as const;

type Row = {
  id: string; startsAt: Date; endsAt: Date; status: string; source: string; serviceName: string;
  durationMinutes: number; priceCents: number; patientNotes: string | null; cancelReason: string | null;
  createdAt: Date; serviceId: string; confirmedAt: Date | null;
  notifications: { channel: string; offsetMinutes: number | null; status: string; error: string | null; createdAt: Date; startsAt: Date }[];
  doctor: { id: string; displayName: string };
  clinicPatient: { id: string; name: string; phone: string; email: string | null };
};

function serialize(a: Row) {
  return {
    id: a.id, startsAt: a.startsAt, endsAt: a.endsAt, status: a.status, source: a.source,
    serviceId: a.serviceId, serviceName: a.serviceName, durationMinutes: a.durationMinutes, priceCents: a.priceCents,
    patientNotes: a.patientNotes, cancelReason: a.cancelReason, createdAt: a.createdAt, confirmedAt: a.confirmedAt,
    doctor: a.doctor, patient: a.clinicPatient,
    // Sólo los envíos del horario vigente (los de un horario anterior ya no aplican).
    reminders: a.notifications
      .filter((n) => n.startsAt.getTime() === a.startsAt.getTime())
      .map(({ startsAt: _s, ...n }) => n),
  };
}

