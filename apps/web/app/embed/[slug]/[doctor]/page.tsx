import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getClinicProfile } from '@/lib/server-api';
import { BookingPage } from '../../../c/[slug]/BookingPage';

type Params = { params: Promise<{ slug: string; doctor: string }> };

export const metadata: Metadata = { title: 'Reservar cita', robots: { index: false, follow: false } };

export default async function Page({ params }: Params) {
  const { slug, doctor } = await params;
  const profile = await getClinicProfile(slug);
  if (!profile || !profile.doctors.some((d) => d.slug === doctor)) notFound();
  return <BookingPage slug={slug} initialProfile={profile} doctorSlug={doctor} embedded />;
}
