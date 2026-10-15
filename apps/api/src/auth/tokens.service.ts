import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { SessionKind } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService, Tx } from '../prisma.service';
import { randomToken, sha256 } from '../common/crypto';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ISSUER = 'medora-api';

export interface StaffClaims {
  typ: 'staff';
  sub: string; // userId
  cid: string; // clinicId
  mid: string; // membershipId
  sid: string; // refresh session id
}

export interface PatientClaims {
  typ: 'patient';
  sub: string; // patientAccountId
  sid: string;
}

type Owner = { kind: 'STAFF'; membershipId: string } | { kind: 'PATIENT'; patientAccountId: string };

@Injectable()
export class TokensService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async signAccess(claims: StaffClaims | PatientClaims): Promise<string> {
    const { sub, ...rest } = claims;
    return new SignJWT({ ...rest })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer(ISSUER)
      .setAudience(claims.typ === 'staff' ? 'medora-staff' : 'medora-patient')
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .setJti(randomUUID())
      .sign(this.config.jwtSecret);
  }

  async verifyAccess<T extends StaffClaims | PatientClaims>(token: string, typ: T['typ']): Promise<T> {
    try {
      const { payload } = await jwtVerify(token, this.config.jwtSecret, {
        issuer: ISSUER,
        audience: typ === 'staff' ? 'medora-staff' : 'medora-patient',
        algorithms: ['HS256'],
      });
      if (payload.typ !== typ || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
        throw new Error('claims');
      }
      if (typ === 'staff' && (typeof payload.cid !== 'string' || typeof payload.mid !== 'string')) {
        throw new Error('claims');
      }
      return payload as unknown as T;
    } catch {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }
  }

  /** Crea una sesión de refresh nueva (familia nueva salvo que se indique). */
  async createRefresh(owner: Owner, tx: Tx | PrismaService = this.prisma, familyId: string = randomUUID()) {
    const token = randomToken();
    const session = await tx.refreshSession.create({
      data: {
        kind: owner.kind as SessionKind,
        familyId,
        tokenHash: sha256(token),
        membershipId: owner.kind === 'STAFF' ? owner.membershipId : null,
        patientAccountId: owner.kind === 'PATIENT' ? owner.patientAccountId : null,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return { token, session };
  }

  /**
   * Rota un refresh token. Reclama el token con una actualización condicional;
   * si ya fue usado o revocado, revoca toda la familia (detección de reutilización).
   */
  async rotate(token: string, kind: SessionKind) {
    const tokenHash = sha256(token);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.refreshSession.findUnique({ where: { tokenHash } });
      if (!current || current.kind !== kind) throw new UnauthorizedException('Sesión inválida');
      const now = new Date();
      if (current.usedAt || current.revokedAt) {
        await tx.refreshSession.updateMany({
          where: { familyId: current.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        return { reused: true as const };
      }
      if (current.expiresAt <= now) throw new UnauthorizedException('Sesión vencida');
      const claimed = await tx.refreshSession.updateMany({
        where: { id: current.id, usedAt: null, revokedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        await tx.refreshSession.updateMany({
          where: { familyId: current.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        return { reused: true as const };
      }
      const owner: Owner = current.kind === 'STAFF'
        ? { kind: 'STAFF', membershipId: current.membershipId! }
        : { kind: 'PATIENT', patientAccountId: current.patientAccountId! };
      const next = await this.createRefresh(owner, tx, current.familyId);
      return { reused: false as const, previous: current, ...next };
    });
  }

  async revokeFamilyByToken(token: string): Promise<void> {
    const current = await this.prisma.refreshSession.findUnique({ where: { tokenHash: sha256(token) } });
    if (!current) return;
    await this.revokeFamily(current.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Comprueba que la sesión que emitió el JWT siga vigente (logout/reutilización revocan la familia). */
  async assertSessionActive(sessionId: string): Promise<void> {
    const s = await this.prisma.refreshSession.findUnique({
      where: { id: sessionId },
      select: { revokedAt: true, expiresAt: true },
    });
    if (!s || s.revokedAt || s.expiresAt <= new Date()) {
      throw new UnauthorizedException('Sesión revocada');
    }
  }
}
