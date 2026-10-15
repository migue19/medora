import {
  Body, ConflictException, Controller, Get, HttpCode, Inject, Patch, Post, Req, Res, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IsEmail, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { getDummyHash, hashPassword, verifyPassword } from '../common/crypto';
import { assertOrigin, clientIp, normalizeEmail, refreshCookieOptions } from '../common/http';
import { RateLimiter } from '../common/rate-limit';
import { Staff, StaffContext, StaffGuard } from './guards';
import { ACCESS_TTL_SECONDS, TokensService } from './tokens.service';

export const STAFF_COOKIE = 'medora_staff_rt';
const STAFF_COOKIE_PATH = '/api/auth';

class StaffLoginDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(1) @MaxLength(200) password: string;
  @IsString() @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/) @Length(3, 60) clinicSlug: string;
}

class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(200) currentPassword: string;
  @IsString() @MinLength(12) @MaxLength(200) newPassword: string;
}

export const loginLimiter = new RateLimiter(10, 60_000);

@Controller('api')
export class StaffAuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
  ) {}

  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() dto: StaffLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertOrigin(req, this.config);
    loginLimiter.consume(`login:${clientIp(req)}`);
    const email = normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = await verifyPassword(dto.password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !ok || !user.active) throw new UnauthorizedException('Correo, contraseña o clínica incorrectos');
    const membership = await this.prisma.membership.findFirst({
      where: { userId: user.id, active: true, clinic: { slug: dto.clinicSlug, active: true } },
      include: { clinic: true },
    });
    if (!membership) throw new UnauthorizedException('Correo, contraseña o clínica incorrectos');
    // Serializa con el cambio de contraseña: no emitir sesión si el hash cambió mientras se verificaba.
    const { token, session } = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ passwordHash: string }[]>`
        SELECT "passwordHash" FROM "User" WHERE id = ${user.id}::uuid FOR SHARE`;
      if (rows[0]?.passwordHash !== user.passwordHash) {
        throw new UnauthorizedException('Correo, contraseña o clínica incorrectos');
      }
      return this.tokens.createRefresh({ kind: 'STAFF', membershipId: membership.id }, tx);
    });
    res.cookie(STAFF_COOKIE, token, refreshCookieOptions(this.config, STAFF_COOKIE_PATH));
    return this.sessionPayload(user.id, membership.id, membership.clinicId, session.id);
  }

  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertOrigin(req, this.config);
    const token = req.cookies?.[STAFF_COOKIE];
    if (typeof token !== 'string' || !token) throw new UnauthorizedException('Sin sesión');
    const result = await this.tokens.rotate(token, 'STAFF');
    if (result.reused) {
      res.clearCookie(STAFF_COOKIE, { path: STAFF_COOKIE_PATH });
      throw new UnauthorizedException('Sesión revocada');
    }
    const membership = await this.prisma.membership.findUnique({
      where: { id: result.session.membershipId! },
      include: { user: true, clinic: true },
    });
    if (!membership || !membership.active || !membership.user.active || !membership.clinic.active) {
      await this.tokens.revokeFamily(result.session.familyId);
      res.clearCookie(STAFF_COOKIE, { path: STAFF_COOKIE_PATH });
      throw new UnauthorizedException('Sesión inválida');
    }
    res.cookie(STAFF_COOKIE, result.token, refreshCookieOptions(this.config, STAFF_COOKIE_PATH));
    return this.sessionPayload(membership.userId, membership.id, membership.clinicId, result.session.id);
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertOrigin(req, this.config);
    const token = req.cookies?.[STAFF_COOKIE];
    if (typeof token === 'string' && token) await this.tokens.revokeFamilyByToken(token);
    res.clearCookie(STAFF_COOKIE, { path: STAFF_COOKIE_PATH });
  }

  @Get('me')
  @UseGuards(StaffGuard)
  async me(@Staff() staff: StaffContext) {
    return this.profile(staff.membershipId);
  }

  @Patch('me/password')
  @UseGuards(StaffGuard)
  @HttpCode(204)
  async changePassword(@Staff() staff: StaffContext, @Body() dto: ChangePasswordDto) {
    if (dto.currentPassword === dto.newPassword) throw new ConflictException('La nueva contraseña debe ser distinta');
    const newHash = await hashPassword(dto.newPassword);
    await this.prisma.$transaction(async (tx) => {
      // Bloquea la identidad para serializar con otros cambios de contraseña.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${staff.userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: staff.userId } });
      if (!(await verifyPassword(dto.currentPassword, user.passwordHash))) {
        throw new UnauthorizedException('La contraseña actual no es correcta');
      }
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
      await tx.refreshSession.updateMany({
        where: { membership: { userId: user.id }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  private async sessionPayload(userId: string, membershipId: string, clinicId: string, sessionId: string) {
    const accessToken = await this.tokens.signAccess({
      typ: 'staff', sub: userId, cid: clinicId, mid: membershipId, sid: sessionId,
    });
    return { accessToken, expiresIn: ACCESS_TTL_SECONDS, ...(await this.profile(membershipId)) };
  }

  private async profile(membershipId: string) {
    const m = await this.prisma.membership.findUniqueOrThrow({
      where: { id: membershipId },
      include: { user: true, clinic: true, doctor: { select: { id: true, displayName: true } } },
    });
    return {
      user: { id: m.user.id, name: m.user.name, email: m.user.email },
      membership: { id: m.id, role: m.role, doctorId: m.doctor?.id ?? null },
      clinic: { id: m.clinic.id, name: m.clinic.name, slug: m.clinic.slug, timezone: m.clinic.timezone },
    };
  }
}
