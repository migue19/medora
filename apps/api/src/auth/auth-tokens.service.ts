import { Injectable } from '@nestjs/common';
import { AuthToken, AuthTokenKind } from '@prisma/client';
import { PrismaService, Tx } from '../prisma.service';
import { randomToken, sha256 } from '../common/crypto';

export const VERIFY_TTL_MS = 24 * 60 * 60_000;
export const RESET_TTL_MS = 30 * 60_000;

type Owner = { patientAccountId: string } | { userId: string };

/** Tokens de un solo uso enviados por correo. Sólo se guarda su SHA-256. */
@Injectable()
export class AuthTokensService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(tx: Tx | PrismaService, kind: AuthTokenKind, owner: Owner, email: string, ttlMs: number): Promise<string> {
    const token = randomToken();
    await tx.authToken.create({
      data: {
        kind, email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs),
        patientAccountId: 'patientAccountId' in owner ? owner.patientAccountId : null,
        userId: 'userId' in owner ? owner.userId : null,
      },
    });
    return token;
  }

  /** Reclama el token con una actualización condicional: sólo una petición concurrente lo obtiene. */
  async consume(tx: Tx, kind: AuthTokenKind, token: string): Promise<AuthToken | null> {
    const tokenHash = sha256(token);
    const claimed = await tx.authToken.updateMany({
      where: { tokenHash, kind, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) return null;
    return tx.authToken.findUnique({ where: { tokenHash } });
  }

  async find(kind: AuthTokenKind, token: string): Promise<AuthToken | null> {
    const row = await this.prisma.authToken.findUnique({ where: { tokenHash: sha256(token) } });
    return row && row.kind === kind ? row : null;
  }

  /** Invalida los demás tokens pendientes del mismo tipo (p. ej. al restablecer la contraseña). */
  async invalidateOthers(tx: Tx, kind: AuthTokenKind, owner: Owner): Promise<void> {
    await tx.authToken.updateMany({
      where: { kind, usedAt: null, ...owner },
      data: { usedAt: new Date() },
    });
  }
}
