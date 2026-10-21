import type { MetadataRoute } from 'next';
import { getSitemapData, siteUrl } from '@/lib/server-api';

// Se genera al pedirlo (con caché de 10 min en la consulta a la API), no al compilar.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = siteUrl();
  const clinics = await getSitemapData();
  return [
    { url: `${site}/`, changeFrequency: 'monthly', priority: 0.5 },
    ...clinics.flatMap((c) => [
      { url: `${site}/c/${c.slug}`, lastModified: new Date(c.updatedAt), changeFrequency: 'daily' as const, priority: 1 },
      ...c.doctors.map((d) => ({
        url: `${site}/c/${c.slug}/${d.slug}`, lastModified: new Date(d.updatedAt), changeFrequency: 'daily' as const, priority: 0.9,
      })),
    ]),
  ];
}
