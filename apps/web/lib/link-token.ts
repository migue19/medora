'use client';

/**
 * Lee el token del fragmento (#) del enlace recibido por correo y lo quita de la barra de direcciones.
 * El fragmento nunca se envía al servidor ni aparece en el Referer.
 */
export function takeLinkToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = window.location.hash.slice(1);
  if (token) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return /^[A-Za-z0-9_-]{20,200}$/.test(token) ? token : null;
}

export type Audience = 'paciente' | 'personal';

export function audienceFromQuery(): Audience {
  if (typeof window === 'undefined') return 'paciente';
  return new URLSearchParams(window.location.search).get('tipo') === 'personal' ? 'personal' : 'paciente';
}
