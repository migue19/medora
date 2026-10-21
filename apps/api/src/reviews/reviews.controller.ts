import {
  Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { assertOrigin, clientIp } from '../common/http';
import { Patient, PatientContext, PatientGuard, Roles, Staff, StaffContext, StaffGuard } from '../auth/guards';
import { tokenLimiter } from '../auth/limits';
import { HIDE_REASONS, ReviewsService } from './reviews.service';

const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

class RatingsDto {
  @IsInt() @Min(1) @Max(5) ratingPunctuality: number;
  @IsInt() @Min(1) @Max(5) ratingTreatment: number;
  @IsInt() @Min(1) @Max(5) ratingFacilities: number;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000) comment?: string | null;
  @IsOptional() @IsBoolean() anonymous?: boolean;
}

class TokenReviewDto extends RatingsDto {
  @IsString() @Length(20, 200) token: string;
}

class TokenDto {
  @IsString() @Length(20, 200) token: string;
}

class HideDto {
  @IsIn(Object.keys(HIDE_REASONS)) reason: string;
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) note?: string | null;
}

class NoteDto {
  @IsOptional() @Transform(emptyToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) note?: string | null;
}

class ReplyDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MinLength(2) @MaxLength(1000) text: string;
}

class ListDto {
  @IsOptional() @IsIn(['PUBLISHED', 'HIDDEN']) status?: 'PUBLISHED' | 'HIDDEN';
  @IsOptional() @IsUUID() doctorId?: string;
}

class PageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) page?: number;
}

/** Invitación por correo: consultar la cita y publicar la opinión (el enlace sirve una vez). */
@Controller('api/public/reviews')
export class PublicReviewsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly reviews: ReviewsService,
  ) {}

  @Post('inspect')
  @HttpCode(200)
  async inspect(@Body() dto: TokenDto, @Req() req: Request) {
    assertOrigin(req, this.config);
    tokenLimiter.consume(`token:${clientIp(req)}`);
    return this.reviews.inspectInvitation(dto.token);
  }

  @Post()
  async submit(@Body() dto: TokenReviewDto, @Req() req: Request) {
    assertOrigin(req, this.config);
    tokenLimiter.consume(`token:${clientIp(req)}`);
    const { token, ...input } = dto;
    return this.reviews.submitWithToken(token, input);
  }

  /** Opiniones publicadas de un médico (paginadas; la primera página también llega en la página del médico). */
  @Get('clinics/:slug/doctors/:doctorSlug')
  async list(@Param('slug') slug: string, @Param('doctorSlug') doctorSlug: string, @Query() q: PageDto) {
    const doctor = await this.prisma.doctor.findFirst({
      where: { slug: doctorSlug, active: true, clinic: { slug, active: true } }, select: { id: true },
    });
    if (!doctor) throw new NotFoundException('Médico no encontrado');
    return this.reviews.publicList(doctor.id, q.page ?? 1);
  }
}

@Controller('api/patient/appointments')
@UseGuards(PatientGuard)
export class PatientReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post(':id/review')
  async submit(@Patient() patient: PatientContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RatingsDto) {
    return this.reviews.submitFromPortal(patient.id, id, dto);
  }
}

@Controller('api/clinic/reviews')
@UseGuards(StaffGuard)
export class StaffReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  async list(@Staff() staff: StaffContext, @Query() q: ListDto) {
    return { reasons: HIDE_REASONS, reviews: await this.reviews.listForStaff(staff, q) };
  }

  @Post(':id/hide')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(200)
  async hide(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HideDto) {
    return this.reviews.hide(staff, id, dto.reason, dto.note ?? null);
  }

  @Post(':id/restore')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(200)
  async restore(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    return this.reviews.restore(staff, id, dto.note ?? null);
  }

  @Put(':id/reply')
  async reply(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplyDto) {
    return this.reviews.reply(staff, id, dto.text);
  }

  @Delete(':id/reply')
  async removeReply(@Staff() staff: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.reviews.reply(staff, id, null);
  }
}
