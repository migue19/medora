import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getDirectoryOverview, jsonLd, searchDirectory, siteUrl } from '@/lib/server-api';
import { DirectoryView, toParams } from '../DirectoryView';
import { listingJsonLd } from '../listing';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ especialidad: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function load(slug: string) {
  const overview = await getDirectoryOverview();
  const specialty = overview.specialties.find((s) => s.slug === slug);
  return specialty ? { overview, specialty } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { especialidad } = await params;
  const data = await load(especialidad);
  if (!data) return { title: 'Especialidad no encontrada', robots: { index: false } };
  const { specialty } = data;
  return {
    title: `${specialty.name}: médicos con cita en línea`,
    description: `${specialty.doctors} ${specialty.doctors === 1 ? 'médico' : 'médicos'} de ${specialty.name.toLowerCase()} con precios, opiniones verificadas y horarios disponibles. Reserva en línea.`,
    alternates: { canonical: `${siteUrl()}/directorio/${specialty.slug}` },
  };
}

/** Página por especialidad (entrada desde buscadores). */
export default async function Page({ params, searchParams }: Props) {
  const { especialidad } = await params;
  const data = await load(especialidad);
  if (!data) notFound();
  const page = toParams(await searchParams).get('pagina');
  const query = new URLSearchParams({ especialidad, orden: 'disponibilidad', ...(page ? { pagina: page } : {}) });
  const result = await searchDirectory(query, (await headers()).get('x-forwarded-for'));
  const url = `${siteUrl()}/directorio/${especialidad}`;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(listingJsonLd(result, url, siteUrl())) }} />
      <DirectoryView title={data.specialty.name} intro="Médicos ordenados por próxima disponibilidad. Elige un horario y confirma en un paso."
        params={query} data={result} overview={data.overview} basePath={`/directorio/${especialidad}`} pageParams={new URLSearchParams()} />
    </>
  );
}
