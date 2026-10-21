import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/c/'],
      // Panel, portal, API, widget y páginas de enlaces de un solo uso no se indexan.
      disallow: ['/panel', '/paciente', '/api/', '/embed/', '/login', '/verificar', '/restablecer', '/recuperar', '/invitacion', '/cita', '/lista-espera', '/vincular', '/opinion', '/alta', '/offline'],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
