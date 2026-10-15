import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, HttpCode, Inject, Post, Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { hashPassword, sha256 } from '../common/crypto';
import { assertOrigin, clientIp } from '../common/http';
import { tokenLimiter } from './limits';

class InspectDto {
  @IsString() @Length(20, 200) token: string;
}

class AcceptDto {
  @IsString() @Length(20, 200) token: string;
  /** Obligatoria sólo si el correo todavía no tiene cuenta de personal. */
  @IsOptional() @IsString() @MinLength(12) @MaxLength(200) password?: string;
}

const INVALID = 'La invitación no es válida o ya venció. Pide una nueva a tu clínica.';

/** Rutas públicas: el token de la invitación prueba que la persona controla ese correo. */
@Controller('api/auth/invitations')
export class InvitationsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  @Post('inspect')
  @HttpCode(200)
  async inspect(@Body() dto: InspectDto, @Req() req: Request) {
    assertOrigin(req, this.config);
    tokenLimiter.consume(`token:${clientIp(req)}`);
    const invitation = await this.prisma.staffInvitation.findUnique({
      where: { tokenHash: sha256(dto.token) }, include: { clinic: true },
    });
    if (
      !invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date() ||
      !invitation.clinic.active
    ) {
      throw new BadRequestException(INVALID);
    }
    const user = await this.prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
    return {
      clinic: { name: invitation.clinic.name, slug: invitation.clinic.slug },
      name: invitation.name, email: invitation.email, role: invitation.role, existingUser: user !== null,
    };
  }

  @Post('accept')
  @HttpCode(200)
  async accept(@Body() dto: AcceptDto, @Req() req: Request) {
    assertOrigin(req, this.config);
    tokenLimiter.consume(`token:${clientIp(req)}`);
    const passwordHash = dto.password ? await hashPassword(dto.password) : null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string; clinicId: string }[]>`
          SELECT id, "clinicId" FROM "StaffInvitation" WHERE "tokenHash" = ${sha256(dto.token)} FOR UPDATE`;
        if (!rows.length) throw new BadRequestException(INVALID);
        // Serializa con los cambios del equipo de la clínica.
        await tx.$queryRaw`SELECT id FROM "Clinic" WHERE id = ${rows[0].clinicId}::uuid FOR UPDATE`;
        const invitation = await tx.staffInvitation.findUniqueOrThrow({ where: { id: rows[0].id }, include: { clinic: true } });
        if (
          invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date() || !invitation.clinic.active
        ) {
          throw new BadRequestException(INVALID);
        }
        let user = await tx.user.findUnique({ where: { email: invitation.email } });
        const existingUser = user !== null;
        if (user) {
          if (!user.active) throw new ForbiddenException('Tu cuenta está desactivada. Comunícate con soporte.');
          const member = await tx.membership.findUnique({
            where: { userId_clinicId: { userId: user.id, clinicId: invitation.clinicId } },
          });
          if (member) throw new ConflictException('Ya eres parte del equipo de esta clínica');
        } else {
          if (!passwordHash) throw new BadRequestException('Elige una contraseña de al menos 12 caracteres');
          user = await tx.user.create({ data: { email: invitation.email, name: invitation.name, passwordHash } });
        }
        const membership = await tx.membership.create({
          data: { userId: user.id, clinicId: invitation.clinicId, role: invitation.role },
        });
        await tx.staffInvitation.update({
          where: { id: invitation.id }, data: { acceptedAt: new Date(), membershipId: membership.id },
        });
        return { clinic: { name: invitation.clinic.name, slug: invitation.clinic.slug }, email: user.email, existingUser };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Esa cuenta se creó mientras tanto. Vuelve a abrir la invitación.');
      }
      throw e;
    }
  }
}
