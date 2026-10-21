import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getClinicProfile, jsonLd, siteUrl } from '@/lib/server-api';
import { doctorJsonLd, doctorMetadata } from '@/lib/seo';
import { BookingPage } from '../BookingPage';

type Params = { params: Promise<{ slug: string; doctor: string }> };

async function load(slug: string, doctorSlug: string) {
  const profile = await getClinicProfile(slug);
  const doctor = profile?.doctors.find((d) => d.slug === doctorSlug);
  return profile && doctor ? { profile, doctor } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, doctor } = await params;
  const data = await load(slug, doctor);
  if (!data) return { title: 'Médico no encontrado', robots: { index: false } };
  return doctorMetadata(data.profile, data.doctor, `${siteUrl()}/c/${slug}/${doctor}`, siteUrl());
}

/** Página de un médico: perfil profesional y su agenda en línea. */
export default async function Page({ params }: Params) {
  const { slug, doctor } = await params;
  const data = await load(slug, doctor);
  if (!data) notFound();
  const url = `${siteUrl()}/c/${slug}/${doctor}`;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(doctorJsonLd(data.profile, data.doctor, url, siteUrl())) }} />
      <BookingPage slug={slug} initialProfile={data.profile} doctorSlug={doctor} />
    </>
  );
}
