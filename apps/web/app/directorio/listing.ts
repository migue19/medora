import type { DirectorySearch } from '@/lib/server-api';

/** Lista de médicos de una página del directorio (schema.org ItemList). */
export function listingJsonLd(data: DirectorySearch, url: string, site: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    url,
    numberOfItems: data.total,
    itemListElement: data.results.map((r, i) => ({
      '@type': 'ListItem',
      position: (data.page - 1) * data.pageSize + i + 1,
      item: {
        '@type': 'Physician',
        name: r.doctor.displayName,
        url: `${site}/c/${r.clinic.slug}/${r.doctor.slug}`,
        medicalSpecialty: r.doctor.specialty,
        image: r.doctor.photoUrl ? `${site}${r.doctor.photoUrl}` : undefined,
        address: r.locations[0]?.city
          ? { '@type': 'PostalAddress', addressLocality: r.locations[0].city, addressCountry: 'MX', streetAddress: r.locations[0].address ?? undefined }
          : undefined,
        aggregateRating: r.rating && r.rating.count > 0
          ? { '@type': 'AggregateRating', ratingValue: r.rating.average, reviewCount: r.rating.count, bestRating: 5, worstRating: 1 }
          : undefined,
      },
    })),
  };
}
