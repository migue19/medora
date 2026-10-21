import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getClinicProfile } from '@/lib/server-api';
import { BookingPage } from '../../c/[slug]/BookingPage';

type Params = { params: Promise<{ slug: string }> };

// Versión para el widget en el sitio de la clínica: no se indexa (la canónica es /c/<clínica>).
export const metadata: Metadata = { title: 'Reservar cita', robots: { index: false, follow: false } };

export default async function Page({ params }: Params) {
  const { slug } = await params;
  const profile = await getClinicProfile(slug);
  if (!profile) notFound();
  return <BookingPage slug={slug} initialProfile={profile} embedded />;
}
