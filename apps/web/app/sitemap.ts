import type { MetadataRoute } from 'next';
import { getDirectoryOverview, getSitemapData, siteUrl } from '@/lib/server-api';

// Se genera al pedirlo (con caché de 10 min en la consulta a la API), no al compilar.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = siteUrl();
  const [clinics, directory] = await Promise.all([getSitemapData(), getDirectoryOverview()]);
  return [
    { url: `${site}/`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${site}/directorio`, changeFrequency: 'daily', priority: 0.8 },
    ...directory.specialties.map((s) => ({ url: `${site}/directorio/${s.slug}`, changeFrequency: 'daily' as const, priority: 0.8 })),
    ...directory.combos.map((c) => ({
      url: `${site}/directorio/${c.specialty}/${c.city}`, lastModified: new Date(c.updatedAt), changeFrequency: 'daily' as const, priority: 0.7,
    })),
    ...clinics.flatMap((c) => [
      { url: `${site}/c/${c.slug}`, lastModified: new Date(c.updatedAt), changeFrequency: 'daily' as const, priority: 1 },
      ...c.doctors.map((d) => ({
        url: `${site}/c/${c.slug}/${d.slug}`, lastModified: new Date(d.updatedAt), changeFrequency: 'daily' as const, priority: 0.9,
      })),
    ]),
  ];
}
