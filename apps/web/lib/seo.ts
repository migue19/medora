import type { Metadata } from 'next';
import { minutesToHHMM, money } from './format';
import type { PublicDoctor, PublicLocation, PublicProfile } from './server-api';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function postal(address: string | null) {
  return address ? { '@type': 'PostalAddress', streetAddress: address, addressCountry: 'MX' } : undefined;
}

function openingHours(l: PublicLocation) {
  return l.hours.map((h) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: `https://schema.org/${DAYS[h.weekday - 1]}`,
    opens: minutesToHHMM(h.startMinute),
    closes: minutesToHHMM(h.endMinute === 1440 ? 1439 : h.endMinute),
  }));
}

function place(l: PublicLocation) {
  return {
    '@type': 'Place', name: l.name, address: postal(l.address), telephone: l.phone ?? undefined,
    hasMap: l.mapUrl ?? undefined, openingHoursSpecification: openingHours(l),
  };
}

/** Precio mínimo y máximo de los servicios de un médico (para la descripción y los datos estructurados). */
function priceRange(d: PublicDoctor): string | undefined {
  const prices = d.services.flatMap((s) => Object.values(s.priceByLocation).concat(s.priceCents));
  if (!prices.length) return undefined;
  const min = Math.min(...prices); const max = Math.max(...prices);
  return min === max ? money(min) : `${money(min)} – ${money(max)}`;
}

export function clinicJsonLd(p: PublicProfile, url: string, site: string) {
  const main = p.locations[0];
  return {
    '@context': 'https://schema.org',
    '@type': 'MedicalClinic',
    '@id': `${url}#clinica`,
    name: p.clinic.name,
    url,
    telephone: p.clinic.phone ?? main?.phone ?? undefined,
    address: postal(main?.address ?? p.clinic.address),
    openingHoursSpecification: main ? openingHours(main) : undefined,
    location: p.locations.length > 1 ? p.locations.map(place) : undefined,
    medicalSpecialty: [...new Set(p.doctors.map((d) => d.specialty))],
    potentialAction: p.clinic.bookingEnabled ? { '@type': 'ReserveAction', target: url } : undefined,
    member: p.doctors.map((d) => ({
      '@type': 'Physician', name: d.displayName, url: `${site}/c/${p.clinic.slug}/${d.slug}`,
      aggregateRating: d.rating && d.rating.count > 0
        ? { '@type': 'AggregateRating', ratingValue: d.rating.average, reviewCount: d.rating.count, bestRating: 5 }
        : undefined,
    })),
  };
}

export function doctorJsonLd(p: PublicProfile, d: PublicDoctor, url: string, site: string) {
  const locations = p.locations.filter((l) => d.locationIds.includes(l.id));
  return {
    '@context': 'https://schema.org',
    '@type': 'Physician',
    '@id': `${url}#medico`,
    name: d.displayName,
    url,
    image: d.photoUrl ? `${site}${d.photoUrl}` : undefined,
    description: d.bio ?? undefined,
    medicalSpecialty: d.specialty,
    knowsLanguage: d.languages.length ? d.languages : undefined,
    isAcceptingNewPatients: p.clinic.bookingEnabled,
    priceRange: priceRange(d),
    telephone: locations[0]?.phone ?? p.clinic.phone ?? undefined,
    address: postal(locations[0]?.address ?? p.clinic.address),
    location: locations.length > 1 ? locations.map(place) : undefined,
    hospitalAffiliation: { '@type': 'MedicalClinic', name: p.clinic.name, url: `${site}/c/${p.clinic.slug}` },
    availableService: d.services.map((s) => ({ '@type': 'MedicalProcedure', name: s.name })),
    // Sólo opiniones verificadas (de citas atendidas) y publicadas.
    aggregateRating: d.rating && d.rating.count > 0
      ? { '@type': 'AggregateRating', ratingValue: d.rating.average, reviewCount: d.rating.count, bestRating: 5, worstRating: 1 }
      : undefined,
    review: d.reviews.length ? d.reviews.map((r) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: r.authorName },
      datePublished: r.createdAt.slice(0, 10),
      reviewBody: r.comment ?? undefined,
      reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5, worstRating: 1 },
    })) : undefined,
    potentialAction: p.clinic.bookingEnabled ? { '@type': 'ReserveAction', target: url } : undefined,
  };
}

const truncate = (s: string, n = 158) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function clinicMetadata(p: PublicProfile, url: string, site: string): Metadata {
  const specialties = [...new Set(p.doctors.map((d) => d.specialty))].slice(0, 4).join(', ');
  const where = p.locations.map((l) => l.address).filter(Boolean)[0];
  const description = truncate(
    `Agenda tu cita en línea en ${p.clinic.name}${specialties ? `: ${specialties}` : ''}. ${p.doctors.length} ${p.doctors.length === 1 ? 'médico' : 'médicos'}${where ? ` · ${where}` : ''}. Elige horario y confirma en minutos.`,
  );
  const title = `${p.clinic.name} · Citas en línea`;
  return {
    title: { absolute: `${title} | Tepahti` },
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', url, title, description, siteName: 'Tepahti', locale: 'es_MX', images: [{ url: `${site}/brand/og.png`, width: 1200, height: 630 }] },
    twitter: { card: 'summary', title, description },
  };
}

export function doctorMetadata(p: PublicProfile, d: PublicDoctor, url: string, site: string): Metadata {
  const range = priceRange(d);
  const stars = d.rating && d.rating.count > 0 ? ` ★ ${d.rating.average.toFixed(1)} (${d.rating.count} ${d.rating.count === 1 ? 'opinión' : 'opiniones'}).` : '';
  const description = truncate(
    `${d.displayName}, ${d.specialty} en ${p.clinic.name}.${stars}${d.conditions.length ? ` Atiende ${d.conditions.slice(0, 3).join(', ')}.` : ''}${range ? ` Consulta desde ${range.split(' – ')[0]}.` : ''} Agenda tu cita en línea.`,
  );
  const title = `${d.displayName} · ${d.specialty}`;
  const image = d.photoUrl ? `${site}${d.photoUrl}` : `${site}/icons/icon-512.png`;
  return {
    title: { absolute: `${title} | ${p.clinic.name}` },
    description,
    alternates: { canonical: url },
    openGraph: { type: 'profile', url, title, description, siteName: 'Tepahti', locale: 'es_MX', images: [{ url: image }] },
    twitter: { card: d.photoUrl ? 'summary_large_image' : 'summary', title, description, images: [image] },
  };
}
