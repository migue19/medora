import {
  Body, CanActivate, Controller, createParamDecorator, Delete, ExecutionContext, ForbiddenException, Get, HttpCode, Injectable,
  NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, SetMetadata, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
  MinLength, ValidateNested,
} from 'class-validator';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma.service';
import { RateLimiter } from '../common/rate-limit';
import { normalizeEmail } from '../common/http';
import { Roles, Staff, StaffContext, StaffGuard } from '../auth/guards';
import { PHONE_PATTERN } from '../patient/patient-auth.controller';
import { Actor, AppointmentsService } from '../appointments/appointments.service';
import { ApiClient, IntegrationsService } from './integrations.service';
import { APPOINTMENT_API_INCLUDE, WEBHOOK_EVENTS, apiAppointment } from './serialize';

const SCOPE_KEY = 'api-scope';
const RequireScope = (scope: 'read' | 'write') => SetMetadata(SCOPE_KEY, scope);
const ApiClientParam = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Request & { apiClient: ApiClient }>().apiClient);
const apiLimiter = new RateLimiter(600, 60_000);

/** Llave de la API pública en `Authorization: Bearer mdr_…`, con su alcance (read o write) y límite por llave. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly integrations: IntegrationsService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request & { apiClient?: ApiClient }>();
    const header = req.headers.authorization ?? '';
    const client = header.startsWith('Bearer ') ? await this.integrations.authenticate(header.slice(7).trim()) : null;
    if (!client) throw new UnauthorizedException('Llave de API inválida o revocada');
    apiLimiter.consume(`api:${client.keyId}`);
    const scope = this.reflector.getAllAndOverride<string>(SCOPE_KEY, [ctx.getHandler(), ctx.getClass()]) ?? 'read';
    if (!client.scopes.includes(scope)) throw new ForbiddenException(`La llave no tiene permiso «${scope}»`);
    req.apiClient = client;
    return true;
  }
}

const actorOf = (c: ApiClient): Actor => ({ kind: 'STAFF', id: c.keyId, name: `API · ${c.name}`.slice(0, 120) });

class ListDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string;
  @IsOptional() @IsUUID() doctorId?: string;
  @IsOptional() @IsIn(['booked', 'completed', 'no_show', 'cancelled', 'pending_payment']) status?: string;
  /** Sólo las que cambiaron desde esta fecha (sincronización incremental). */
  @IsOptional() @IsISO8601() updatedSince?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

class AvailabilityDto {
  @IsUUID() doctorId: string;
  @IsUUID() serviceId: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(14) days?: number;
}

class PatientInput {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsString() @Matches(PHONE_PATTERN) phone: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
}

class CreateDto {
  /** Referencia del integrador: repetir la petición con el mismo requestId devuelve la misma cita. */
  @IsUUID() requestId: string;
  @IsUUID() doctorId: string;
  @IsUUID() serviceId: string;
  @IsISO8601({ strict: true }) startsAt: string;
  @ValidateNested() @Type(() => PatientInput) patient: PatientInput;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsIn(['in_person', 'video']) modality?: string;
}

class CancelDto {
  @IsString() @MinLength(2) @MaxLength(200) reason: string;
}

const STATUS_IN: Record<string, string> = { booked: 'BOOKED', completed: 'COMPLETED', no_show: 'NO_SHOW', cancelled: 'CANCELLED', pending_payment: 'PENDING_PAYMENT' };
const PAGE = 100;

/** API pública v1 para integradores (sistemas de la clínica, CRM, contabilidad). */
@Controller('api/v1')
@UseGuards(ApiKeyGuard)
export class ApiV1Controller {
  constructor(private readonly prisma: PrismaService, private readonly appointments: AppointmentsService) {}

  @Get('doctors')
  async doctors(@ApiClientParam() c: ApiClient) {
    const rows = await this.prisma.doctor.findMany({ where: { clinicId: c.clinicId }, orderBy: { displayName: 'asc' }, include: { services: true } });
    return { data: rows.map((d) => ({ id: d.id, name: d.displayName, specialty: d.specialty, active: d.active, serviceIds: d.services.map((s) => s.serviceId) })) };
  }

  @Get('services')
  async services(@ApiClientParam() c: ApiClient) {
    const rows = await this.prisma.service.findMany({ where: { clinicId: c.clinicId }, orderBy: { name: 'asc' } });
    return { data: rows.map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes, priceCents: s.priceCents, telemedicine: s.telemedicine, active: s.active })) };
  }

  @Get('locations')
  async locations(@ApiClientParam() c: ApiClient) {
    const rows = await this.prisma.location.findMany({ where: { clinicId: c.clinicId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return { data: rows.map((l) => ({ id: l.id, name: l.name, address: l.address, phone: l.phone, active: l.active })) };
  }

  @Get('availability')
  async availability(@ApiClientParam() c: ApiClient, @Query() q: AvailabilityDto) {
    const r = await this.appointments.availability({ clinicId: c.clinicId, doctorId: q.doctorId, serviceId: q.serviceId, from: q.from, days: q.days ?? 7 });
    return { timezone: r.timezone, data: r.days.map((d) => ({ date: d.date, slots: d.slots.map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt, locationId: s.locationId ?? null })) })) };
  }

  @Get('appointments')
  async list(@ApiClientParam() c: ApiClient, @Query() q: ListDto) {
    const clinic = await this.prisma.clinic.findUniqueOrThrow({ where: { id: c.clinicId } });
    const from = DateTime.fromISO(q.from, { zone: clinic.timezone }).startOf('day');
    const to = DateTime.fromISO(q.to, { zone: clinic.timezone }).startOf('day').plus({ days: 1 });
    const page = q.page ?? 1;
    const where = {
      clinicId: c.clinicId, startsAt: { gte: from.toJSDate(), lt: to.toJSDate() },
      ...(q.doctorId ? { doctorId: q.doctorId } : {}),
      ...(q.status ? { status: STATUS_IN[q.status] as never } : {}),
      ...(q.updatedSince ? { updatedAt: { gte: new Date(q.updatedSince) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.appointment.findMany({ where, include: APPOINTMENT_API_INCLUDE, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], skip: (page - 1) * PAGE, take: PAGE }),
      this.prisma.appointment.count({ where }),
    ]);
    return { data: rows.map(apiAppointment), page, pageSize: PAGE, total, hasMore: page * PAGE < total };
  }

  @Get('appointments/:id')
  async get(@ApiClientParam() c: ApiClient, @Param('id', ParseUUIDPipe) id: string) {
    const a = await this.prisma.appointment.findFirst({ where: { id, clinicId: c.clinicId }, include: APPOINTMENT_API_INCLUDE });
    if (!a) throw new NotFoundException('Cita no encontrada');
    return { data: apiAppointment(a) };
  }

  /** Agenda una cita como recepción (respeta el horario del médico y evita empalmes). El paciente se busca por teléfono o correo. */
  @Post('appointments')
  @RequireScope('write')
  async create(@ApiClientParam() c: ApiClient, @Body() dto: CreateDto) {
    const digits = dto.patient.phone.replace(/\D/g, '').slice(-10);
    const email = dto.patient.email ? normalizeEmail(dto.patient.email) : null;
    const existing = (await this.prisma.clinicPatient.findMany({
      where: { clinicId: c.clinicId, mergedIntoId: null, OR: [{ phone: { endsWith: digits.slice(-4) } }, ...(email ? [{ email }] : [])] },
    })).find((p) => p.phone.replace(/\D/g, '').slice(-10) === digits || (email && p.email === email));
    const patient = existing ?? await this.prisma.clinicPatient.create({
      data: { clinicId: c.clinicId, name: dto.patient.name, phone: dto.patient.phone, email },
    });
    const { appointment } = await this.appointments.book({
      clinicId: c.clinicId, doctorId: dto.doctorId, serviceId: dto.serviceId, clinicPatientId: patient.id, startsAt: new Date(dto.startsAt),
      notes: dto.notes ?? null, source: 'STAFF', requestId: dto.requestId, actor: actorOf(c), channel: 'api',
      modality: dto.modality === 'video' ? 'VIDEO' : 'IN_PERSON',
    });
    const full = await this.prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id }, include: APPOINTMENT_API_INCLUDE });
    return { data: apiAppointment(full) };
  }

  @Post('appointments/:id/cancel')
  @HttpCode(200)
  @RequireScope('write')
  async cancel(@ApiClientParam() c: ApiClient, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    const a = await this.prisma.appointment.findFirst({ where: { id, clinicId: c.clinicId } });
    if (!a) throw new NotFoundException('Cita no encontrada');
    await this.appointments.cancel({ appointment: a, reason: dto.reason, actor: actorOf(c), minMinutesBefore: null });
    const full = await this.prisma.appointment.findUniqueOrThrow({ where: { id }, include: APPOINTMENT_API_INCLUDE });
    return { data: apiAppointment(full) };
  }
}

// ---------------------------------------------------------------- panel: llaves y webhooks

class KeyDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsArray() @ArrayMaxSize(2) @IsIn(['read', 'write'], { each: true }) scopes: string[];
}

class EndpointDto {
  @IsString() @MaxLength(500) url: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsIn(WEBHOOK_EVENTS, { each: true }) events?: string[];
}

class EndpointPatchDto {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsIn(WEBHOOK_EVENTS, { each: true }) events?: string[];
}

@Controller('api/clinic/integrations')
@UseGuards(StaffGuard)
@Roles('OWNER', 'ADMIN')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  async overview(@Staff() s: StaffContext) {
    const [keys, webhooks] = await Promise.all([this.integrations.listKeys(s.clinicId), this.integrations.listEndpoints(s.clinicId)]);
    return { keys, webhooks, events: WEBHOOK_EVENTS };
  }

  @Post('keys')
  createKey(@Staff() s: StaffContext, @Body() dto: KeyDto) {
    const scopes = [...new Set(['read', ...dto.scopes])];
    return this.integrations.createKey(s.clinicId, s.userId, dto.name, scopes);
  }

  @Delete('keys/:id')
  @HttpCode(204)
  revokeKey(@Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.revokeKey(s.clinicId, id);
  }

  @Post('webhooks')
  createEndpoint(@Staff() s: StaffContext, @Body() dto: EndpointDto) {
    return this.integrations.createEndpoint(s.clinicId, dto.url.trim(), dto.events ?? []);
  }

  @Patch('webhooks/:id')
  @HttpCode(204)
  updateEndpoint(@Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EndpointPatchDto) {
    return this.integrations.updateEndpoint(s.clinicId, id, dto);
  }

  @Delete('webhooks/:id')
  @HttpCode(204)
  deleteEndpoint(@Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.deleteEndpoint(s.clinicId, id);
  }

  @Post('webhooks/:id/ping')
  @HttpCode(200)
  ping(@Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.ping(s.clinicId, id);
  }
}
