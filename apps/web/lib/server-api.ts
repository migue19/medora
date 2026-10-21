/** URL interna de la API (red de Docker en producción) y URL pública del sitio, leídas en tiempo de ejecución. */
export const apiBase = () => process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:6010';
export const siteUrl = () => (process.env.SITE_URL ?? 'http://localhost:6011').replace(/\/$/, '');

export interface PublicService {
  id: string; name: string; durationMinutes: number; priceCents: number; visitType: 'ANY' | 'FIRST' | 'FOLLOW_UP';
  priceByLocation: Record<string, number>;
}
export interface PublicDoctor {
  id: string; displayName: string; slug: string; specialty: string; licenseNumber: string | null; bio: string | null;
  services: PublicService[]; photoUrl: string | null; locationIds: string[];
  education: string[]; certifications: string[]; languages: string[]; conditions: string[]; insurers: string[];
}
export interface PublicLocation {
  id: string; name: string; address: string | null; phone: string | null; mapUrl: string | null;
  hours: { weekday: number; startMinute: number; endMinute: number }[];
}
export interface PublicProfile {
  clinic: {
    name: string; slug: string; phone: string | null; address: string | null; timezone: string; bookingEnabled: boolean;
    patientCancelMinMinutes: number;
  };
  locations: PublicLocation[];
  doctors: PublicDoctor[];
}

/** Perfil público de la clínica, en caché 60 s (lo comparten todas las visitas y los buscadores). */
export async function getClinicProfile(slug: string): Promise<PublicProfile | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) return null;
  const res = await fetch(`${apiBase()}/api/public/clinics/${slug}`, { next: { revalidate: 60, tags: [`clinic:${slug}`] } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`No se pudo cargar la clínica (${res.status})`);
  return res.json();
}

export async function getSitemapData(): Promise<{ slug: string; updatedAt: string; doctors: { slug: string; updatedAt: string }[] }[]> {
  const res = await fetch(`${apiBase()}/api/public/sitemap`, { next: { revalidate: 600 } });
  if (!res.ok) throw new Error(`No se pudo cargar el mapa del sitio (${res.status})`);
  return res.json();
}

/** JSON-LD seguro dentro de <script>: evita que el contenido cierre la etiqueta. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
