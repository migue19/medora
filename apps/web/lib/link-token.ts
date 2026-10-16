'use client';

/**
 * Lee el token del fragmento (#) del enlace recibido por correo y lo quita de la barra de direcciones.
 * El fragmento nunca se envía al servidor ni aparece en el Referer.
 */
export function takeLinkToken(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  // Los botones de WhatsApp no admiten fragmento: ahí el token llega como ?t=
  const token = window.location.hash.slice(1) || params.get('t') || '';
  if (token) {
    params.delete('t');
    const query = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
  }
  return /^[A-Za-z0-9_-]{20,200}$/.test(token) ? token : null;
}

export type Audience = 'paciente' | 'personal';

export function audienceFromQuery(): Audience {
  if (typeof window === 'undefined') return 'paciente';
  return new URLSearchParams(window.location.search).get('tipo') === 'personal' ? 'personal' : 'paciente';
}
