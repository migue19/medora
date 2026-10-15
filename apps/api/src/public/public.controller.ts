import {
  Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Transform, Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { PrismaService } from '../prisma.service';
import { Patient, PatientContext, PatientGuard } from '../auth/guards';
import { AppointmentsService } from '../appointments/appointments.service';
import { RateLimiter } from '../common/rate-limit';
import { clientIp } from '../common/http';

const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

class AvailabilityDto {
  @IsUUID() serviceId: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(14) days?: number;
}

class BookDto {
  @IsUUID() requestId: string;
  @IsUUID() doctorId: string;
  @IsUUID() serviceId: string;
  @IsISO8601({ strict: true }) startsAt: string;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500)
  notes?: string | null;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const publicLimiter = new RateLimiter(120, 60_000);

@Controller('api/public/clinics')
export class PublicController {
  constructor(private readonly prisma: PrismaService, private readonly appointments: AppointmentsService) {}

  private async clinic(slug: string) {
    if (!SLUG.test(slug) || slug.length > 60) throw new NotFoundException('Clínica no encontrada');
    const clinic = await this.prisma.clinic.findFirst({ where: { slug, active: true } });
    if (!clinic) throw new NotFoundException('Clínica no encontrada');
    return clinic;
  }

  @Get(':slug')
  async profile(@Param('slug') slug: string, @Req() req: Request) {
    publicLimiter.consume(`public:${clientIp(req)}`);
    const clinic = await this.clinic(slug);
    const doctors = await this.prisma.doctor.findMany({
      where: { clinicId: clinic.id, active: true },
      include: {
        services: {
          where: { service: { active: true } },
          include: { service: true },
        },
      },
      orderBy: { displayName: 'asc' },
    });
    return {
      clinic: {
        name: clinic.name, slug: clinic.slug, phone: clinic.phone, address: clinic.address,
        timezone: clinic.timezone, bookingEnabled: clinic.bookingEnabled,
        patientCancelMinMinutes: clinic.patientCancelMinMinutes,
      },
      doctors: doctors
        .filter((d) => d.services.length > 0)
        .map((d) => ({
          id: d.id, displayName: d.displayName, specialty: d.specialty, licenseNumber: d.licenseNumber, bio: d.bio,
          services: d.services
            .map(({ service: s }) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes, priceCents: s.priceCents }))
            .sort((a, b) => a.name.localeCompare(b.name, 'es')),
        })),
    };
  }

  @Get(':slug/doctors/:doctorId/availability')
  async availability(
    @Param('slug') slug: string, @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Query() q: AvailabilityDto, @Req() req: Request,
  ) {
    publicLimiter.consume(`public:${clientIp(req)}`);
    const clinic = await this.clinic(slug);
    if (!clinic.bookingEnabled) {
      return { timezone: clinic.timezone, bookingEnabled: false, days: [] };
    }
    const result = await this.appointments.availability({
      clinicId: clinic.id, doctorId, serviceId: q.serviceId, from: q.from, days: q.days ?? 7,
    });
    return { ...result, bookingEnabled: true };
  }

  @Post(':slug/appointments')
  @UseGuards(PatientGuard)
  async book(@Param('slug') slug: string, @Patient() patient: PatientContext, @Body() dto: BookDto) {
    const clinic = await this.clinic(slug);
    if (!patient.emailVerified) {
      throw new ForbiddenException('Confirma tu correo para reservar. Te enviamos un enlace al registrarte.');
    }
    // Ficha del paciente en la clínica: se crea al reservar por primera vez.
    const clinicPatient = await this.prisma.clinicPatient.upsert({
      where: { clinicId_patientAccountId: { clinicId: clinic.id, patientAccountId: patient.id } },
      update: {},
      create: {
        clinicId: clinic.id, patientAccountId: patient.id, name: patient.name, phone: patient.phone, email: patient.email,
      },
    });
    const { appointment, replayed } = await this.appointments.book({
      clinicId: clinic.id, doctorId: dto.doctorId, serviceId: dto.serviceId, clinicPatientId: clinicPatient.id,
      startsAt: new Date(dto.startsAt), notes: dto.notes ?? null, source: 'ONLINE', requestId: dto.requestId,
      actor: { kind: 'PATIENT', id: patient.id, name: patient.name },
    });
    return { appointment, replayed };
  }
}
