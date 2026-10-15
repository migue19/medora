import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StaffRole } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service';
import { PatientClaims, StaffClaims, TokensService } from './tokens.service';

export interface StaffContext {
  userId: string;
  clinicId: string;
  membershipId: string;
  role: StaffRole;
  name: string;
  sessionId: string;
  doctorId: string | null;
}

export interface PatientContext {
  id: string;
  name: string;
  email: string;
  phone: string;
  emailVerified: boolean;
  sessionId: string;
}

type AuthedRequest = Request & { staff?: StaffContext; patient?: PatientContext };

export const ROLES_KEY = 'medora:roles';
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

function bearer(req: Request): string {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Falta la sesión');
  return header.slice(7).trim();
}

@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const claims = await this.tokens.verifyAccess<StaffClaims>(bearer(req), 'staff');
    await this.tokens.assertSessionActive(claims.sid);
    const membership = await this.prisma.membership.findUnique({
      where: { id: claims.mid },
      include: { user: true, clinic: true, doctor: { select: { id: true } } },
    });
    if (
      !membership || membership.userId !== claims.sub || membership.clinicId !== claims.cid ||
      !membership.active || !membership.user.active || !membership.clinic.active
    ) {
      throw new UnauthorizedException('Sesión inválida');
    }
    req.staff = {
      userId: membership.userId,
      clinicId: membership.clinicId,
      membershipId: membership.id,
      role: membership.role,
      name: membership.user.name,
      sessionId: claims.sid,
      doctorId: membership.doctor?.id ?? null,
    };
    const roles = this.reflector.getAllAndOverride<StaffRole[] | undefined>(ROLES_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (roles && !roles.includes(membership.role)) {
      throw new ForbiddenException('Tu rol no tiene permiso para esta acción');
    }
    return true;
  }
}

@Injectable()
export class PatientGuard implements CanActivate {
  constructor(private readonly tokens: TokensService, private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const claims = await this.tokens.verifyAccess<PatientClaims>(bearer(req), 'patient');
    await this.tokens.assertSessionActive(claims.sid);
    const account = await this.prisma.patientAccount.findUnique({ where: { id: claims.sub } });
    if (!account || !account.active) throw new UnauthorizedException('Sesión inválida');
    req.patient = {
      id: account.id, name: account.name, email: account.email, phone: account.phone,
      emailVerified: account.emailVerifiedAt !== null, sessionId: claims.sid,
    };
    return true;
  }
}

export const Staff = createParamDecorator((_: unknown, ctx: ExecutionContext): StaffContext => {
  const staff = ctx.switchToHttp().getRequest<AuthedRequest>().staff;
  if (!staff) throw new UnauthorizedException();
  return staff;
});

export const Patient = createParamDecorator((_: unknown, ctx: ExecutionContext): PatientContext => {
  const patient = ctx.switchToHttp().getRequest<AuthedRequest>().patient;
  if (!patient) throw new UnauthorizedException();
  return patient;
});
