import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Límite en memoria por clave. Corresponde a una sola réplica de la API;
 * antes de escalar horizontalmente usar almacenamiento compartido.
 */
export class RateLimiter {
  /** Se puede desactivar sólo en pruebas automatizadas. */
  static enabled = true;
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  consume(key: string, now = Date.now()): void {
    if (!RateLimiter.enabled) return;
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 50_000) this.sweep(now);
      return;
    }
    entry.count += 1;
    if (entry.count > this.limit) {
      throw new HttpException('Demasiados intentos. Espera un momento.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private sweep(now: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
