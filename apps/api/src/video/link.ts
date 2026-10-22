import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Enlace de la videoconsulta para el correo: el id de la cita firmado con HMAC. No se guarda en la base y
 * sirve en cualquier correo (confirmación, recordatorios); sólo abre la sala en la ventana de la cita vigente.
 */
export function videoLinkToken(secret: Uint8Array, appointmentId: string): string {
  const id = Buffer.from(appointmentId.replace(/-/g, ''), 'hex').toString('base64url');
  return `${id}${sign(secret, appointmentId)}`;
}

export function readVideoLinkToken(secret: Uint8Array, token: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const hex = Buffer.from(token.slice(0, 22), 'base64url').toString('hex');
  if (hex.length !== 32) return null;
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const expected = Buffer.from(sign(secret, id));
  const given = Buffer.from(token.slice(22));
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

function sign(secret: Uint8Array, appointmentId: string): string {
  return createHmac('sha256', Buffer.from(secret)).update(`video:${appointmentId}`).digest('base64url').slice(0, 32);
}
