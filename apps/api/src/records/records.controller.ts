import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe,
  Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength,
  MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { DateTime } from 'luxon';
import { APP_CONFIG, AppConfig } from '../config';
import { clientIp } from '../common/http';
import { RateLimiter } from '../common/rate-limit';
import { Roles, Staff, StaffContext, StaffGuard } from '../auth/guards';
import { PrismaService } from '../prisma.service';
import { MAX_FILE_BYTES, RecordsService } from './records.service';
import { prescriptionPdf } from './prescription-pdf';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value);
const TEXT = 10_000;

class ProfileDto {
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) birthDate?: string | null;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsIn(['F', 'M', 'X']) sex?: string | null;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null)
  @Matches(/^[A-Za-z][AEIOUXaeioux][A-Za-z]{2}\d{6}[HMXhmx][A-Za-z]{5}[0-9A-Za-z]\d$/, { message: 'CURP inválida' }) curp?: string | null;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']) bloodType?: string | null;
  @IsOptional() @IsObject() history?: Record<string, string>;
}

class AllergyDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) substance: string;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) reaction?: string | null;
  @IsIn(['LEVE', 'MODERADA', 'GRAVE']) severity: string;
}

class AllergyStateDto {
  @IsBoolean() active: boolean;
}

class DiagnosisDto {
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(10) code: string | null;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(255) description: string;
}

class NoteDto {
  @IsOptional() @IsString() @MaxLength(TEXT) subjective?: string;
  @IsOptional() @IsString() @MaxLength(TEXT) objective?: string;
  @IsOptional() @IsString() @MaxLength(TEXT) assessment?: string;
  @IsOptional() @IsString() @MaxLength(TEXT) plan?: string;
  @IsOptional() @IsObject() vitals?: Record<string, unknown>;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => DiagnosisDto) diagnoses?: DiagnosisDto[];
}

class CreateNoteDto extends NoteDto {
  @IsOptional() @IsUUID() appointmentId?: string;
  @IsOptional() @IsUUID() amendsId?: string;
}

class ItemDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(200) drug: string;
  @Transform(trim) @IsString() @MaxLength(120) presentation: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) dose: string;
  @Transform(trim) @IsString() @MaxLength(60) route: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) frequency: string;
  @Transform(trim) @IsString() @MaxLength(120) duration: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) instructions?: string;
}

class PrescriptionDto {
  @IsOptional() @IsUUID() noteId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(15) @ValidateNested({ each: true }) @Type(() => ItemDto) items: ItemDto[];
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(2000) instructions?: string | null;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) diagnosis?: string | null;
}

class VoidDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) reason: string;
}

class FileDto {
  @IsOptional() @IsUUID() noteId?: string;
}

class SearchDto {
  @IsString() @MaxLength(60) q: string;
}

class RangeDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string;
}

class ClinicalAccessDto {
  @IsBoolean() clinicalAccess: boolean;
}

@Controller('api/clinic')
@UseGuards(StaffGuard)
export class RecordsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly records: RecordsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('patients/:id/record')
  record(@Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.records.record(s, id, clientIp(req));
  }

  @Patch('patients/:id/record/profile')
  profile(@Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProfileDto, @Req() req: Request) {
    return this.records.updateProfile(s, id, dto, clientIp(req));
  }

  @Post('patients/:id/record/allergies')
  addAllergy(@Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AllergyDto, @Req() req: Request) {
    return this.records.addAllergy(s, id, dto, clientIp(req));
  }

  @Patch('patients/:id/record/allergies/:allergyId')
  allergyState(
    @Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Param('allergyId', ParseUUIDPipe) allergyId: string,
    @Body() dto: AllergyStateDto, @Req() req: Request,
  ) {
    return this.records.setAllergyActive(s, id, allergyId, dto.active, clientIp(req));
  }

  @Post('patients/:id/record/notes')
  createNote(@Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateNoteDto, @Req() req: Request) {
    return this.records.createNote(s, id, dto, clientIp(req));
  }

  @Patch('patients/:id/record/notes/:noteId')
  updateNote(
    @Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: NoteDto, @Req() req: Request,
  ) {
    return this.records.updateNote(s, id, noteId, dto, clientIp(req));
  }

  @Post('patients/:id/record/notes/:noteId/sign')
  @HttpCode(200)
  sign(@Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Param('noteId', ParseUUIDPipe) noteId: string, @Req() req: Request) {
    return this.records.signNote(s, id, noteId, clientIp(req));
  }

  @Post('patients/:id/record/prescriptions')
  prescribe(@Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PrescriptionDto, @Req() req: Request) {
    return this.records.prescribe(s, id, dto, clientIp(req));
  }

  @Post('patients/:id/record/prescriptions/:pid/void')
  @HttpCode(200)
  voidPrescription(
    @Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: VoidDto, @Req() req: Request,
  ) {
    return this.records.voidPrescription(s, id, pid, dto.reason, clientIp(req));
  }

  @Get('patients/:id/record/prescriptions/:pid/pdf')
  async pdf(
    @Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Param('pid', ParseUUIDPipe) pid: string,
    @Req() req: Request, @Res() res: Response,
  ) {
    const data = await this.records.prescriptionForPrint(s, id, pid, clientIp(req));
    const pdf = await prescriptionPdf(data, `${this.config.webOrigin}/receta/${data.prescription.code}`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receta-${data.prescription.code}.pdf"`);
    res.send(pdf);
  }

  @Post('patients/:id/record/files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  upload(
    @Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FileDto, @Req() req: Request,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
  ) {
    if (!file) throw new BadRequestException('Falta el archivo');
    return this.records.upload(s, id, file, dto.noteId ?? null, clientIp(req));
  }

  @Get('patients/:id/record/files/:fileId')
  async download(
    @Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string,
    @Req() req: Request, @Res() res: Response,
  ) {
    const f = await this.records.download(s, id, fileId, clientIp(req));
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
    res.send(f.content);
  }

  @Get('patients/:id/record/log')
  log(@Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.records.accessLog(s, id, clientIp(req));
  }

  @Get('icd10')
  async icd10(@Staff() s: StaffContext, @Query() q: SearchDto) {
    if (s.role === 'RECEPTION') throw new ForbiddenException();
    return this.records.searchIcd10(q.q);
  }

  /** Bitácora de toda la clínica: sólo el propietario. */
  @Get('clinical-audit')
  @Roles('OWNER')
  async audit(@Staff() s: StaffContext, @Query() q: RangeDto) {
    const clinic = await this.prisma.clinic.findUniqueOrThrow({ where: { id: s.clinicId } });
    const from = DateTime.fromISO(q.from, { zone: clinic.timezone }).startOf('day');
    const to = DateTime.fromISO(q.to, { zone: clinic.timezone }).startOf('day').plus({ days: 1 });
    return this.records.clinicLog(s, from.toJSDate(), to.toJSDate());
  }

  /** El propietario autoriza (o retira) el acceso a todos los expedientes, p. ej. a la dirección médica. */
  @Patch('members/:id/clinical-access')
  @Roles('OWNER')
  async clinicalAccess(@Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ClinicalAccessDto) {
    const m = await this.prisma.membership.findFirst({ where: { id, clinicId: s.clinicId } });
    if (!m) throw new NotFoundException('Integrante no encontrado');
    if (m.role === 'RECEPTION' && dto.clinicalAccess) throw new ForbiddenException('Recepción no puede tener acceso al expediente clínico');
    return this.prisma.membership.update({ where: { id }, data: { clinicalAccess: dto.clinicalAccess }, select: { id: true, clinicalAccess: true } });
  }
}

const verifyLimiter = new RateLimiter(60, 60_000);

/** Verificación pública de recetas (farmacias): datos mínimos, sin información clínica del paciente. */
@Controller('api/public/prescriptions')
export class PrescriptionVerifyController {
  constructor(private readonly records: RecordsService) {}

  @Get(':code')
  async verify(@Param('code') code: string, @Req() req: Request) {
    verifyLimiter.consume(`rx:${clientIp(req)}`);
    if (!/^[A-Za-z0-9]{10}$/.test(code)) throw new NotFoundException('Receta no encontrada');
    const r = await this.records.verify(code);
    if (!r) throw new NotFoundException('Receta no encontrada');
    return r;
  }
}
