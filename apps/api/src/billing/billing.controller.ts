import {
  Body, Controller, ForbiddenException, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Req, Res, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { ClinicVerification, Plan } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../config';
import { assertOrigin, clientIp } from '../common/http';
import { RateLimiter } from '../common/rate-limit';
import { Roles, Staff, StaffContext, StaffGuard } from '../auth/guards';
import { PHONE_PATTERN } from '../patient/patient-auth.controller';
import { PrismaService } from '../prisma.service';
import { BillingService } from './billing.service';
import { SignupService } from './signup.service';
import { PLANS, TRIAL_DAYS } from './plans';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class SignupDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(120) clinicName: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(120) ownerName: string;
  @IsEmail() @MaxLength(254) email: string;
  @Transform(trim) @IsString() @Matches(PHONE_PATTERN, { message: 'Teléfono inválido' }) phone: string;
  @IsEnum(Plan) plan: Plan;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(120) doctorName: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(120) specialty: string;
  @Transform(trim) @Matches(/^\d{7,8}$/, { message: 'La cédula profesional tiene 7 u 8 dígitos' }) licenseNumber: string;
  @Equals(true, { message: 'Acepta los términos y el aviso de privacidad' }) acceptTerms: boolean;
}

class PlanDto {
  @IsEnum(Plan) plan: Plan;
}

class CancelDto {
  @IsBoolean() cancel: boolean;
}

class BillingDto {
  @Transform(trim) @Matches(/^[A-Za-zÑñ&]{3,4}\d{6}[A-Za-z0-9]{3}$/, { message: 'RFC inválido' }) rfc: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(254) legalName: string;
  @Matches(/^\d{3}$/) fiscalRegime: string;
  @Matches(/^\d{5}$/, { message: 'El código postal fiscal tiene 5 dígitos' }) zipCode: string;
  @IsOptional() @IsIn(['G03', 'S01', 'D01']) cfdiUse?: string;
  @IsEmail() @MaxLength(254) email: string;
}

class ReviewDto {
  @IsOptional() @IsEnum(ClinicVerification) verification?: ClinicVerification;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(300) note?: string | null;
  @IsOptional() @IsBoolean() billingExempt?: boolean;
}

const signupLimiter = new RateLimiter(5, 60 * 60_000);

@Controller('api/public')
export class SignupController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig, private readonly signup: SignupService) {}

  @Get('plans')
  plans() {
    return { trialDays: TRIAL_DAYS, plans: (Object.keys(PLANS) as Plan[]).map((key) => ({ key, ...PLANS[key] })) };
  }

  @Post('signup')
  @HttpCode(200)
  async create(@Body() dto: SignupDto, @Req() req: Request) {
    assertOrigin(req, this.config);
    signupLimiter.consume(`signup:${clientIp(req)}`);
    return this.signup.signup(dto);
  }
}

@Controller('api/clinic/subscription')
@UseGuards(StaffGuard)
export class SubscriptionController {
  constructor(private readonly billing: BillingService, private readonly prisma: PrismaService) {}

  @Get()
  @Roles('OWNER', 'ADMIN')
  status(@Staff() s: StaffContext) {
    return this.billing.status(s.clinicId);
  }

  @Post('checkout')
  @HttpCode(200)
  @Roles('OWNER')
  async checkout(@Staff() s: StaffContext, @Body() dto: PlanDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
    return this.billing.checkout(s.clinicId, dto.plan, user.email);
  }

  @Post('plan')
  @HttpCode(200)
  @Roles('OWNER')
  plan(@Staff() s: StaffContext, @Body() dto: PlanDto) {
    return this.billing.changePlan(s.clinicId, dto.plan);
  }

  @Post('cancel')
  @HttpCode(200)
  @Roles('OWNER')
  cancel(@Staff() s: StaffContext, @Body() dto: CancelDto) {
    return this.billing.setCancel(s.clinicId, dto.cancel);
  }

  @Post('portal')
  @HttpCode(200)
  @Roles('OWNER')
  portal(@Staff() s: StaffContext) {
    return this.billing.portal(s.clinicId);
  }

  @Put('billing')
  @Roles('OWNER', 'ADMIN')
  saveBilling(@Staff() s: StaffContext, @Body() dto: BillingDto) {
    return this.billing.saveBilling(s.clinicId, dto);
  }

  @Post('invoices/:id/cfdi')
  @HttpCode(200)
  @Roles('OWNER', 'ADMIN')
  requestCfdi(@Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.requestCfdi(s.clinicId, id);
  }

  @Get('invoices/:id/:format')
  @Roles('OWNER', 'ADMIN')
  async download(
    @Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Param('format') format: string, @Res() res: Response,
  ) {
    if (format !== 'pdf' && format !== 'xml') throw new ForbiddenException();
    const f = await this.billing.download(s.clinicId, id, format);
    res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
    res.send(f.content);
  }
}

/** Administración de Medora: verificación de cédulas y clínicas exentas (correos en SUPERADMIN_EMAILS). */
@Controller('api/admin')
@UseGuards(StaffGuard)
export class AdminController {
  constructor(private readonly signup: SignupService) {}

  private async assert(s: StaffContext) {
    if (!(await this.signup.isSuperadmin(s.userId))) throw new ForbiddenException('Sólo para la administración de Medora');
  }

  @Get('clinics')
  async clinics(@Staff() s: StaffContext) {
    await this.assert(s);
    return this.signup.clinics();
  }

  @Patch('clinics/:id')
  async review(@Staff() s: StaffContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    await this.assert(s);
    return this.signup.review(id, dto);
  }
}
