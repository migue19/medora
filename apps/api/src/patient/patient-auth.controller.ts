import {
  Body, ConflictException, Controller, Get, HttpCode, Inject, Patch, Post, Req, Res, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { getDummyHash, hashPassword, verifyPassword } from '../common/crypto';
import { assertOrigin, clientIp, normalizeEmail, refreshCookieOptions } from '../common/http';
import { Patient, PatientContext, PatientGuard } from '../auth/guards';
import { ACCESS_TTL_SECONDS, TokensService } from '../auth/tokens.service';
import { loginLimiter } from '../auth/staff-auth.controller';
import { RateLimiter } from '../common/rate-limit';

export const PATIENT_COOKIE = 'medora_patient_rt';
const PATIENT_COOKIE_PATH = '/api/patient/auth';
export const PHONE_PATTERN = /^\+?[0-9 ()-]{8,20}$/;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class RegisterDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsEmail() @MaxLength(254) email: string;
  @Transform(trim) @IsString() @Matches(PHONE_PATTERN, { message: 'Teléfono inválido' }) phone: string;
  @IsString() @MinLength(10) @MaxLength(200) password: string;
}

class PatientLoginDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(1) @MaxLength(200) password: string;
}

class UpdateProfileDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @Transform(trim) @IsString() @Matches(PHONE_PATTERN, { message: 'Teléfono inválido' }) phone: string;
}

class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(200) currentPassword: string;
  @IsString() @MinLength(10) @MaxLength(200) newPassword: string;
}

const registerLimiter = new RateLimiter(5, 60 * 60_000);

@Controller('api/patient')
export class PatientAuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
  ) {}

  @Post('auth/register')
  @HttpCode(201)
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertOrigin(req, this.config);
    registerLimiter.consume(`register:${clientIp(req)}`);
    const passwordHash = await hashPassword(dto.password);
    try {
      const { account, token, session } = await this.prisma.$transaction(async (tx) => {
        const account = await tx.patientAccount.create({
          data: { email: normalizeEmail(dto.email), name: dto.name, phone: dto.phone, passwordHash },
        });
        const refresh = await this.tokens.createRefresh({ kind: 'PATIENT', patientAccountId: account.id }, tx);
        return { account, ...refresh };
      });
      res.cookie(PATIENT_COOKIE, token, refreshCookieOptions(this.config, PATIENT_COOKIE_PATH));
      return this.sessionPayload(account.id, session.id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe una cuenta con ese correo. Inicia sesión.');
      }
      throw e;
    }
  }

  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() dto: PatientLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertOrigin(req, this.config);
    loginLimiter.consume(`login:${clientIp(req)}`);
    const account = await this.prisma.patientAccount.findUnique({ where: { email: normalizeEmail(dto.email) } });
    const ok = await verifyPassword(dto.password, account?.passwordHash ?? (await getDummyHash()));
    if (!account || !ok || !account.active) throw new UnauthorizedException('Correo o contraseña incorrectos');
    const { token, session } = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ passwordHash: string }[]>`
        SELECT "passwordHash" FROM "PatientAccount" WHERE id = ${account.id}::uuid FOR SHARE`;
      if (rows[0]?.passwordHash !== account.passwordHash) {
        throw new UnauthorizedException('Correo o contraseña incorrectos');
      }
      return this.tokens.createRefresh({ kind: 'PATIENT', patientAccountId: account.id }, tx);
    });
    res.cookie(PATIENT_COOKIE, token, refreshCookieOptions(this.config, PATIENT_COOKIE_PATH));
    return this.sessionPayload(account.id, session.id);
  }

  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertOrigin(req, this.config);
    const token = req.cookies?.[PATIENT_COOKIE];
    if (typeof token !== 'string' || !token) throw new UnauthorizedException('Sin sesión');
    const result = await this.tokens.rotate(token, 'PATIENT');
    if (result.reused) {
      res.clearCookie(PATIENT_COOKIE, { path: PATIENT_COOKIE_PATH });
      throw new UnauthorizedException('Sesión revocada');
    }
    const account = await this.prisma.patientAccount.findUnique({ where: { id: result.session.patientAccountId! } });
    if (!account || !account.active) {
      await this.tokens.revokeFamily(result.session.familyId);
      res.clearCookie(PATIENT_COOKIE, { path: PATIENT_COOKIE_PATH });
      throw new UnauthorizedException('Sesión inválida');
    }
    res.cookie(PATIENT_COOKIE, result.token, refreshCookieOptions(this.config, PATIENT_COOKIE_PATH));
    return this.sessionPayload(account.id, result.session.id);
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertOrigin(req, this.config);
    const token = req.cookies?.[PATIENT_COOKIE];
    if (typeof token === 'string' && token) await this.tokens.revokeFamilyByToken(token);
    res.clearCookie(PATIENT_COOKIE, { path: PATIENT_COOKIE_PATH });
  }

  @Get('me')
  @UseGuards(PatientGuard)
  me(@Patient() patient: PatientContext) {
    return { id: patient.id, name: patient.name, email: patient.email, phone: patient.phone };
  }

  @Patch('me')
  @UseGuards(PatientGuard)
  async updateMe(@Patient() patient: PatientContext, @Body() dto: UpdateProfileDto) {
    const a = await this.prisma.patientAccount.update({
      where: { id: patient.id }, data: { name: dto.name, phone: dto.phone },
    });
    return { id: a.id, name: a.name, email: a.email, phone: a.phone };
  }

  @Patch('me/password')
  @UseGuards(PatientGuard)
  @HttpCode(204)
  async changePassword(@Patient() patient: PatientContext, @Body() dto: ChangePasswordDto) {
    if (dto.currentPassword === dto.newPassword) throw new ConflictException('La nueva contraseña debe ser distinta');
    const newHash = await hashPassword(dto.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PatientAccount" WHERE id = ${patient.id}::uuid FOR UPDATE`;
      const account = await tx.patientAccount.findUniqueOrThrow({ where: { id: patient.id } });
      if (!(await verifyPassword(dto.currentPassword, account.passwordHash))) {
        throw new UnauthorizedException('La contraseña actual no es correcta');
      }
      await tx.patientAccount.update({ where: { id: account.id }, data: { passwordHash: newHash } });
      await tx.refreshSession.updateMany({
        where: { patientAccountId: account.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  private async sessionPayload(accountId: string, sessionId: string) {
    const a = await this.prisma.patientAccount.findUniqueOrThrow({ where: { id: accountId } });
    const accessToken = await this.tokens.signAccess({ typ: 'patient', sub: a.id, sid: sessionId });
    return {
      accessToken,
      expiresIn: ACCESS_TTL_SECONDS,
      patient: { id: a.id, name: a.name, email: a.email, phone: a.phone },
    };
  }
}
