import {
  Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength, ValidateIf,
} from 'class-validator';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { normalizeEmail, assertOrigin, clientIp } from '../common/http';
import { Roles, Staff, StaffContext, StaffGuard } from '../auth/guards';
import { tokenLimiter } from '../auth/limits';
import { PHONE_PATTERN } from '../patient/patient-auth.controller';
import { PATIENT_SELECT, PatientsService, serializePatient, staffActor } from './patients.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

class PatientSearchDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) q?: string;
}

class CreateClinicPatientDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @Transform(trim) @IsString() @Matches(PHONE_PATTERN, { message: 'Teléfono inválido' }) phone: string;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsEmail() @MaxLength(254)
  email?: string | null;
  /** El paciente aceptó (de palabra o por escrito) recibir recordatorios por WhatsApp. */
  @IsOptional() @IsBoolean() whatsappConsent?: boolean;
}

class UpdateClinicPatientDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @Transform(trim) @IsString() @Matches(PHONE_PATTERN, { message: 'Teléfono inválido' }) phone?: string;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsEmail() @MaxLength(254)
  email?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(30, { each: true }) tags?: string[];
  @IsOptional() @IsBoolean() whatsappConsent?: boolean;
}

class NoteDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(2000) body: string;
}

class MergeDto {
  @Matches(/^[0-9a-f-]{36}$/i, { message: 'Ficha inválida' }) sourceId: string;
}

class LinkDto {
  @IsEmail() @MaxLength(254) email: string;
}

class TokenDto {
  @IsString() @Length(20, 200) token: string;
}

@Controller('api/clinic/patients')
@UseGuards(StaffGuard)
export class PatientsController {
  constructor(private readonly prisma: PrismaService, private readonly patients: PatientsService) {}

  @Get()
  @Roles('OWNER', 'ADMIN', 'RECEPTION')
  async list(@Staff() staff: StaffContext, @Query() query: PatientSearchDto) {
    const q = query.q?.trim();
    const rows = await this.prisma.clinicPatient.findMany({
      where: {
        clinicId: staff.clinicId, mergedIntoId: null,
        ...(q ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { email: { contains: q, mode: 'insensitive' } },
            { tags: { has: q.toLowerCase() } },
          ],
        } : {}),
      },
      select: PATIENT_SELECT,
      orderBy: { name: 'asc' },
      take: 50,
    });
    return rows.map(serializePatient);
  }

  @Post()
  @Roles('OWNER', 'ADMIN', 'RECEPTION')
  async create(@Staff() staff: StaffContext, @Body() dto: CreateClinicPatientDto) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.clinicPatient.create({
        data: {
          clinicId: staff.clinicId, name: dto.name, phone: dto.phone,
          email: dto.email ? normalizeEmail(dto.email) : null,
          whatsappConsentAt: dto.whatsappConsent ? new Date() : null,
        },
        select: PATIENT_SELECT,
      });
      await this.patients.audit(tx, staff.clinicId, created.id, 'CREATED', staffActor(staff), {
        name: created.name, phone: created.phone, email: created.email,
      });
      return serializePatient(created);
    });
  }

  @Get(':id')
  async profile(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.patients.profile(staff, id);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN', 'RECEPTION')
  async update(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClinicPatientDto) {
    return this.patients.update(staff, id, dto);
  }

  @Post(':id/notes')
  async addNote(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.patients.addNote(staff, id, dto.body);
  }

  /** Fusiona otra ficha (duplicada) en esta. */
  @Post(':id/merge')
  @Roles('OWNER', 'ADMIN', 'RECEPTION')
  @HttpCode(200)
  async merge(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MergeDto) {
    const result = await this.prisma.$transaction((tx) =>
      this.patients.mergeInto(tx, staff.clinicId, id, dto.sourceId, staffActor(staff)));
    return { ...result, ...(await this.patients.profile(staff, id)) };
  }

  /** Envía al paciente un enlace para confirmar que esta ficha es suya y vincularla con su cuenta. */
  @Post(':id/link')
  @Roles('OWNER', 'ADMIN', 'RECEPTION')
  @HttpCode(200)
  async link(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkDto) {
    return this.patients.requestLink(staff, id, dto.email);
  }
}

/** Rutas públicas del enlace de vinculación (el token prueba que el paciente controla el correo de su cuenta). */
@Controller('api/public/patient-links')
export class PatientLinksController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig, private readonly patients: PatientsService) {}

  @Post('inspect')
  @HttpCode(200)
  async inspect(@Body() dto: TokenDto, @Req() req: Request) {
    assertOrigin(req, this.config);
    tokenLimiter.consume(`token:${clientIp(req)}`);
    return this.patients.inspectLink(dto.token);
  }

  @Post('accept')
  @HttpCode(200)
  async accept(@Body() dto: TokenDto, @Req() req: Request) {
    assertOrigin(req, this.config);
    tokenLimiter.consume(`token:${clientIp(req)}`);
    return this.patients.acceptLink(dto.token);
  }
}
