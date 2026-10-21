import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getClinicProfile, jsonLd, siteUrl } from '@/lib/server-api';
import { clinicJsonLd, clinicMetadata } from '@/lib/seo';
import { BookingPage } from './BookingPage';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const profile = await getClinicProfile(slug);
  if (!profile) return { title: 'Clínica no encontrada', robots: { index: false } };
  return clinicMetadata(profile, `${siteUrl()}/c/${slug}`, siteUrl());
}

export default async function Page({ params }: Params) {
  const { slug } = await params;
  const profile = await getClinicProfile(slug);
  if (!profile) notFound();
  const url = `${siteUrl()}/c/${slug}`;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(clinicJsonLd(profile, url, siteUrl())) }} />
      <BookingPage slug={slug} initialProfile={profile} />
    </>
  );
}
