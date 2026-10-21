import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param,
  ParseUUIDPipe, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length, Matches, MaxLength, ValidateIf } from 'class-validator';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { assertOrigin, clientIp } from '../common/http';
import { Patient, PatientContext, PatientGuard, Roles, Staff, StaffContext, StaffGuard } from '../auth/guards';
import { tokenLimiter } from '../auth/limits';
import { staffActor } from '../patients/patients.service';
import { WaitlistService } from './waitlist.service';

const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

class EntryDto {
  @IsUUID() doctorId: string;
  @IsUUID() serviceId: string;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @Matches(DATE) fromDate?: string | null;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @Matches(DATE) toDate?: string | null;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(300) notes?: string | null;
}

class StaffEntryDto extends EntryDto {
  @IsUUID() clinicPatientId: string;
}

class ListDto {
  @IsOptional() @IsUUID() doctorId?: string;
}

class TokenDto {
  @IsString() @Length(20, 200) token: string;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

@Controller('api/clinic/waitlist')
@UseGuards(StaffGuard)
export class StaffWaitlistController {
  constructor(private readonly prisma: PrismaService, private readonly waitlist: WaitlistService) {}

  @Get()
  async list(@Staff() staff: StaffContext, @Query() q: ListDto) {
    if (staff.role === 'DOCTOR') {
      if (!staff.doctorId) return [];
      if (q.doctorId && q.doctorId !== staff.doctorId) throw new ForbiddenException('Sólo puedes ver tu lista');
      return this.waitlist.list(staff.clinicId, staff.doctorId);
    }
    return this.waitlist.list(staff.clinicId, q.doctorId);
  }

  @Post()
  @Roles('OWNER', 'ADMIN', 'RECEPTION')
  async add(@Staff() staff: StaffContext, @Body() dto: StaffEntryDto) {
    const patient = await this.prisma.clinicPatient.findFirst({
      where: { id: dto.clinicPatientId, clinicId: staff.clinicId, mergedIntoId: null },
    });
    if (!patient) throw new NotFoundException('Paciente no encontrado');
    return this.waitlist.add({ ...dto, clinicId: staff.clinicId, actor: staffActor(staff) });
  }

  @Post(':id/remove')
  @Roles('OWNER', 'ADMIN', 'RECEPTION')
  @HttpCode(204)
  async remove(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.waitlist.remove(staff.clinicId, id);
  }

  /** Recepción agenda el horario apartado en nombre del paciente (p. ej. lo confirmó por teléfono). */
  @Post('offers/:offerId/accept')
  @Roles('OWNER', 'ADMIN', 'RECEPTION')
  @HttpCode(200)
  async accept(@Staff() staff: StaffContext, @Param('offerId', ParseUUIDPipe) offerId: string) {
    return this.waitlist.accept(offerId, staffActor(staff), 'STAFF', staff.clinicId);
  }

  @Post('offers/:offerId/release')
  @Roles('OWNER', 'ADMIN', 'RECEPTION')
  @HttpCode(204)
  async release(@Staff() staff: StaffContext, @Param('offerId', ParseUUIDPipe) offerId: string) {
    await this.waitlist.release(staff.clinicId, offerId);
  }
}

@Controller('api')
export class PatientWaitlistController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly waitlist: WaitlistService,
  ) {}

  /** El paciente se anota desde la página de reservas de la clínica. */
  @Post('public/clinics/:slug/waitlist')
  @UseGuards(PatientGuard)
  async join(@Param('slug') slug: string, @Patient() patient: PatientContext, @Body() dto: EntryDto) {
    if (!SLUG.test(slug)) throw new NotFoundException('Clínica no encontrada');
    const clinic = await this.prisma.clinic.findFirst({ where: { slug, active: true } });
    if (!clinic) throw new NotFoundException('Clínica no encontrada');
    if (!clinic.bookingEnabled) throw new ForbiddenException('La clínica no acepta reservas en línea por ahora');
    if (!patient.emailVerified) throw new ForbiddenException('Confirma tu correo para anotarte en la lista de espera.');
    const clinicPatient = await this.prisma.clinicPatient.upsert({
      where: { clinicId_patientAccountId: { clinicId: clinic.id, patientAccountId: patient.id } },
      update: {},
      create: { clinicId: clinic.id, patientAccountId: patient.id, name: patient.name, phone: patient.phone, email: patient.email },
    });
    return this.waitlist.add({
      ...dto, clinicId: clinic.id, clinicPatientId: clinicPatient.id,
      actor: { kind: 'PATIENT', id: patient.id, name: patient.name },
    });
  }

  @Get('patient/waitlist')
  @UseGuards(PatientGuard)
  async mine(@Patient() patient: PatientContext) {
    const rows = await this.prisma.waitlistEntry.findMany({
      where: { status: 'WAITING', clinicPatient: { patientAccountId: patient.id } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, clinicId: true, doctorId: true, serviceId: true, fromDate: true, toDate: true, createdAt: true },
    });
    const [clinics, doctors, services] = await Promise.all([
      this.prisma.clinic.findMany({ where: { id: { in: rows.map((r) => r.clinicId) } }, select: { id: true, name: true, slug: true } }),
      this.prisma.doctor.findMany({ where: { id: { in: rows.map((r) => r.doctorId) } }, select: { id: true, displayName: true } }),
      this.prisma.service.findMany({ where: { id: { in: rows.map((r) => r.serviceId) } }, select: { id: true, name: true } }),
    ]);
    return rows.map((r) => ({
      ...r,
      clinic: clinics.find((c) => c.id === r.clinicId),
      doctor: doctors.find((d) => d.id === r.doctorId),
      service: services.find((s) => s.id === r.serviceId),
    }));
  }

  @Post('patient/waitlist/:id/leave')
  @UseGuards(PatientGuard)
  @HttpCode(204)
  async leave(@Patient() patient: PatientContext, @Param('id', ParseUUIDPipe) id: string) {
    const entry = await this.prisma.waitlistEntry.findFirst({
      where: { id, clinicPatient: { patientAccountId: patient.id } },
    });
    if (!entry) throw new NotFoundException('No está en la lista de espera');
    await this.waitlist.remove(entry.clinicId, entry.id, entry.clinicPatientId);
  }

  // Enlace del correo con el horario apartado. Consultar no gasta nada; aceptar crea la cita.
  @Post('public/waitlist-offers/inspect')
  @HttpCode(200)
  async inspect(@Body() dto: TokenDto, @Req() req: Request) {
    assertOrigin(req, this.config);
    tokenLimiter.consume(`token:${clientIp(req)}`);
    return this.waitlist.inspect(dto.token);
  }

  @Post('public/waitlist-offers/accept')
  @HttpCode(200)
  async acceptOffer(@Body() dto: TokenDto, @Req() req: Request) {
    assertOrigin(req, this.config);
    tokenLimiter.consume(`token:${clientIp(req)}`);
    const offer = await this.waitlist.findOfferByToken(dto.token);
    const p = offer.entry.clinicPatient;
    const appointment = await this.waitlist.accept(offer.id, { kind: 'PATIENT', id: p.patientAccountId ?? p.id, name: p.name }, 'ONLINE');
    return { appointment: { id: appointment.id, startsAt: appointment.startsAt, status: appointment.status } };
  }

  @Post('public/waitlist-offers/decline')
  @HttpCode(204)
  async decline(@Body() dto: TokenDto, @Req() req: Request) {
    assertOrigin(req, this.config);
    tokenLimiter.consume(`token:${clientIp(req)}`);
    const offer = await this.waitlist.findOfferByToken(dto.token);
    if (offer.status !== 'PENDING') throw new BadRequestException('Esta oferta ya no está vigente');
    await this.waitlist.decline(offer.id);
  }
}
