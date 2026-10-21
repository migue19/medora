import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getDirectoryOverview, jsonLd, searchDirectory, siteUrl } from '@/lib/server-api';
import { DirectoryView, toParams } from '../../DirectoryView';
import { listingJsonLd } from '../../listing';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ especialidad: string; ciudad: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function load(specialtySlug: string, citySlug: string) {
  const overview = await getDirectoryOverview();
  const specialty = overview.specialties.find((s) => s.slug === specialtySlug);
  const city = overview.cities.find((c) => c.slug === citySlug);
  const exists = overview.combos.some((c) => c.specialty === specialtySlug && c.city === citySlug);
  return specialty && city && exists ? { overview, specialty, city } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { especialidad, ciudad } = await params;
  const data = await load(especialidad, ciudad);
  if (!data) return { title: 'Sin resultados', robots: { index: false } };
  return {
    title: `${data.specialty.name} en ${data.city.name}: cita en línea`,
    description: `Médicos de ${data.specialty.name.toLowerCase()} en ${data.city.name} con precios, opiniones verificadas y horarios disponibles. Reserva en línea.`,
    alternates: { canonical: `${siteUrl()}/directorio/${especialidad}/${ciudad}` },
  };
}

/** Página por especialidad y ciudad (entrada desde buscadores). */
export default async function Page({ params, searchParams }: Props) {
  const { especialidad, ciudad } = await params;
  const data = await load(especialidad, ciudad);
  if (!data) notFound();
  const page = toParams(await searchParams).get('pagina');
  const query = new URLSearchParams({ especialidad, ciudad, orden: 'disponibilidad', ...(page ? { pagina: page } : {}) });
  const result = await searchDirectory(query, (await headers()).get('x-forwarded-for'));
  const url = `${siteUrl()}/directorio/${especialidad}/${ciudad}`;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(listingJsonLd(result, url, siteUrl())) }} />
      <DirectoryView title={`${data.specialty.name} en ${data.city.name}`}
        intro="Médicos ordenados por próxima disponibilidad. Elige un horario y confirma en un paso."
        params={query} data={result} overview={data.overview} basePath={`/directorio/${especialidad}/${ciudad}`} pageParams={new URLSearchParams()} />
    </>
  );
}
