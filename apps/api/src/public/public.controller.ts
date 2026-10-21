import {
  Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { pricesFor } from '../scheduling/pricing';
import { ReviewsService } from '../reviews/reviews.service';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
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
  @IsOptional() @IsUUID() locationId?: string;
}

/** Canales de reserva en línea que se registran en la cita (para reportes de origen). */
export const BOOKING_CHANNELS = ['web', 'widget', 'google', 'instagram', 'directorio'] as const;

class BookDto {
  @IsOptional() @IsIn(BOOKING_CHANNELS) channel?: (typeof BOOKING_CHANNELS)[number];
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointments: AppointmentsService,
    private readonly reviews: ReviewsService,
  ) {}

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
    const [doctors, locations] = await Promise.all([
      this.prisma.doctor.findMany({
        where: { clinicId: clinic.id, active: true },
        include: {
          services: {
            where: { service: { active: true } },
            include: { service: true },
          },
          scheduleRules: { select: { locationId: true } },
          photo: { select: { updatedAt: true } },
        },
        orderBy: { displayName: 'asc' },
      }),
      this.prisma.location.findMany({
        where: { clinicId: clinic.id, active: true },
        include: { hours: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    const withPrices = await Promise.all(doctors.filter((d) => d.services.length > 0).map(async (d) => {
      const locationIds = [...new Set(d.scheduleRules.map((r) => r.locationId))];
      const services = await Promise.all(d.services.map(async ({ service: s }) => ({
        id: s.id, name: s.name, durationMinutes: s.durationMinutes, priceCents: s.priceCents, visitType: s.visitType,
        priceByLocation: await pricesFor(this.prisma, s, d.id, locationIds),
      })));
      return { d, locationIds, services };
    }));
    const ratings = await this.reviews.summaries(withPrices.map(({ d }) => d.id));
    const latest = await this.prisma.review.findMany({
      where: { doctorId: { in: withPrices.map(({ d }) => d.id) }, status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' }, take: 50,
    });
    return {
      clinic: {
        name: clinic.name, slug: clinic.slug, phone: clinic.phone, address: clinic.address,
        timezone: clinic.timezone, bookingEnabled: clinic.bookingEnabled,
        patientCancelMinMinutes: clinic.patientCancelMinMinutes,
      },
      locations: locations.map((l) => ({
        id: l.id, name: l.name, address: l.address, phone: l.phone, mapUrl: l.mapUrl,
        hours: l.hours.map(({ weekday, startMinute, endMinute }) => ({ weekday, startMinute, endMinute })),
      })),
      doctors: withPrices.map(({ d, locationIds, services }) => ({
        id: d.id, displayName: d.displayName, slug: d.slug, specialty: d.specialty, licenseNumber: d.licenseNumber, bio: d.bio,
        education: d.education, certifications: d.certifications, languages: d.languages, conditions: d.conditions,
        insurers: d.insurers,
        photoUrl: d.photo ? `/api/public/doctors/${d.id}/photo?v=${d.photo.updatedAt.getTime()}` : null,
        locationIds,
        rating: ratings.get(d.id) ?? null,
        // Las opiniones más recientes (hasta 5) para la página del médico y schema.org.
        reviews: latest.filter((r) => r.doctorId === d.id).slice(0, 5).map((r) => this.reviews.serializePublic(r)),
        services: services.sort((a, b) => a.name.localeCompare(b.name, 'es')),
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
      clinicId: clinic.id, doctorId, serviceId: q.serviceId, from: q.from, days: q.days ?? 7, locationId: q.locationId,
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
      actor: { kind: 'PATIENT', id: patient.id, name: patient.name }, channel: dto.channel ?? 'web',
    });
    return { appointment, replayed };
  }

}

/** Fotos de médicos: públicas, con caché larga porque la URL lleva la versión. */
@Controller('api/public/doctors')
export class DoctorPhotoController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/photo')
  async photo(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const photo = await this.prisma.doctorPhoto.findFirst({ where: { doctorId: id, doctor: { active: true } } });
    if (!photo) throw new NotFoundException('Sin foto');
    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', 'inline');
    res.send(Buffer.from(photo.data));
  }

}

/** Datos para el mapa del sitio: clínicas activas y sus médicos con agenda en línea. */
@Controller('api/public/sitemap')
export class SitemapController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async sitemap() {
    const clinics = await this.prisma.clinic.findMany({
      where: { active: true },
      select: {
        slug: true, updatedAt: true,
        doctors: {
          where: { active: true, services: { some: { service: { active: true } } } },
          select: { slug: true, updatedAt: true },
        },
      },
      orderBy: { slug: 'asc' },
    });
    return clinics;
  }
}
