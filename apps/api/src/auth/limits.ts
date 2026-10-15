import { RateLimiter } from '../common/rate-limit';

/** Solicitudes de recuperación de contraseña: por IP y por correo (no revela si la cuenta existe). */
export const forgotIpLimiter = new RateLimiter(5, 15 * 60_000);
export const forgotEmailLimiter = new RateLimiter(3, 60 * 60_000);
/** Canje de enlaces enviados por correo (verificación, recuperación e invitaciones). */
export const tokenLimiter = new RateLimiter(30, 15 * 60_000);
/** Reenvío del correo de verificación por cuenta. */
export const resendLimiter = new RateLimiter(3, 60 * 60_000);
