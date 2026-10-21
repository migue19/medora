import {
  Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma.service';
import { Patient, PatientContext, PatientGuard } from '../auth/guards';
import { Actor, AppointmentsService } from '../appointments/appointments.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class CancelDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) reason?: string;
}

class RescheduleDto {
  @IsISO8601({ strict: true }) startsAt: string;
  @IsISO8601({ strict: true }) expectedStartsAt: string;
}

const actorOf = (p: PatientContext): Actor => ({ kind: 'PATIENT', id: p.id, name: p.name });

@Controller('api/patient/appointments')
@UseGuards(PatientGuard)
export class PatientAppointmentsController {
  constructor(private readonly prisma: PrismaService, private readonly appointments: AppointmentsService) {}

  @Get()
  async list(@Patient() patient: PatientContext) {
    const now = new Date();
    const include = {
      clinic: { select: { name: true, slug: true, timezone: true, phone: true, address: true, patientCancelMinMinutes: true, bookingEnabled: true, reviewsEnabled: true } },
      doctor: { select: { id: true, displayName: true, specialty: true } },
      location: { select: { name: true, address: true, phone: true, mapUrl: true } },
      review: { select: { id: true } },
    } as const;
    const where = { clinicPatient: { patientAccountId: patient.id } };
    const [upcoming, past] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { ...where, status: 'BOOKED', endsAt: { gt: now } },
        include, orderBy: { startsAt: 'asc' }, take: 100,
      }),
      this.prisma.appointment.findMany({
        where: { ...where, OR: [{ status: { not: 'BOOKED' } }, { endsAt: { lte: now } }] },
        include, orderBy: { startsAt: 'desc' }, take: 50,
      }),
    ]);
    const map = (a: (typeof upcoming)[number]) => ({
      id: a.id, startsAt: a.startsAt, endsAt: a.endsAt, status: a.status, serviceId: a.serviceId,
      serviceName: a.serviceName, durationMinutes: a.durationMinutes, priceCents: a.priceCents,
      patientNotes: a.patientNotes, cancelReason: a.cancelReason, clinic: a.clinic, doctor: a.doctor, location: a.location,
      reviewed: a.review !== null,
      canReview: a.status === 'COMPLETED' && a.review === null && a.clinic.reviewsEnabled,
      canChangeOnline:
        a.status === 'BOOKED' && a.clinic.bookingEnabled &&
        a.startsAt.getTime() - now.getTime() >= a.clinic.patientCancelMinMinutes * 60_000,
    });
    return { upcoming: upcoming.map(map), past: past.map(map) };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Patient() patient: PatientContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    const { appointment, clinic } = await this.own(patient, id);
    return this.appointments.cancel({
      appointment, reason: dto.reason || 'Cancelada por el paciente', actor: actorOf(patient),
      minMinutesBefore: clinic.patientCancelMinMinutes,
    });
  }

  @Post(':id/reschedule')
  @HttpCode(200)
  async reschedule(
    @Patient() patient: PatientContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RescheduleDto,
  ) {
    const { appointment } = await this.own(patient, id);
    return this.appointments.reschedule({
      appointment, startsAt: new Date(dto.startsAt), expectedStartsAt: new Date(dto.expectedStartsAt),
      actor: actorOf(patient), online: true,
    });
  }

  /** Horarios para reprogramar: excluye la propia cita para permitir moverla a un horario contiguo. */
  @Get(':id/availability/:from')
  async availability(
    @Patient() patient: PatientContext, @Param('id', ParseUUIDPipe) id: string, @Param('from') from: string,
  ) {
    const { appointment } = await this.own(patient, id);
    return this.appointments.availability({
      clinicId: appointment.clinicId, doctorId: appointment.doctorId, serviceId: appointment.serviceId,
      from, days: 7, excludeAppointmentId: appointment.id, durationMinutes: appointment.durationMinutes,
    });
  }

  private async own(patient: PatientContext, id: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, clinicPatient: { patientAccountId: patient.id } },
      include: { clinic: true },
    });
    if (!appointment) throw new NotFoundException('Cita no encontrada');
    const { clinic, ...rest } = appointment;
    return { appointment: rest, clinic };
  }
}
