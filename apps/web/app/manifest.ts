import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Medora · Citas médicas',
    short_name: 'Medora',
    description: 'Agenda y reservas de citas médicas en línea.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    lang: 'es-MX',
    background_color: '#f6f8f8',
    theme_color: '#0f766e',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
