import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getDirectoryOverview, searchDirectory, siteUrl } from '@/lib/server-api';
import { DirectoryView, toParams } from './DirectoryView';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const DESCRIPTION = 'Busca médico por especialidad, padecimiento o zona, compara precios y opiniones verificadas, y reserva tu cita en línea al instante.';

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = toParams(await searchParams);
  params.delete('pagina');
  return {
    title: 'Directorio médico · Reserva tu cita en línea',
    description: DESCRIPTION,
    alternates: { canonical: `${siteUrl()}/directorio` },
    // Cada combinación de filtros es una búsqueda, no una página: sólo se indexa la portada (y las páginas por especialidad).
    robots: params.size ? { index: false, follow: true } : undefined,
  };
}

export default async function Page({ searchParams }: Props) {
  const params = toParams(await searchParams);
  const [data, overview] = await Promise.all([
    searchDirectory(params, (await headers()).get('x-forwarded-for')),
    getDirectoryOverview(),
  ]);
  const what = data.resolved.specialty?.name ?? data.resolved.condition?.name;
  const city = overview.cities.find((c) => c.slug === params.get('ciudad'))?.name;
  const title = what ? `${what}${city ? ` en ${city}` : ''}` : city ? `Médicos en ${city}` : 'Encuentra médico y reserva en línea';
  return <DirectoryView title={title} intro={what || city ? undefined : DESCRIPTION} params={params} data={data} overview={overview} />;
}
