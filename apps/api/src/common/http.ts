import { ForbiddenException } from '@nestjs/common';
import type { CookieOptions, Request } from 'express';
import { AppConfig } from '../config';
import { REFRESH_TTL_MS } from '../auth/tokens.service';

/** Los POST de autenticación exigen Origin exacto para prevenir CSRF. */
export function assertOrigin(req: Request, config: AppConfig): void {
  if (req.headers.origin !== config.webOrigin) {
    throw new ForbiddenException('Origen no permitido');
  }
}

export function refreshCookieOptions(config: AppConfig, path: string): CookieOptions {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path,
    maxAge: REFRESH_TTL_MS,
  };
}

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
