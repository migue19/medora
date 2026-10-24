import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tepahti · Citas médicas',
    short_name: 'Tepahti',
    description: 'Agenda y reservas de citas médicas en línea.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    lang: 'es-MX',
    background_color: '#f7f5f0',
    theme_color: '#0b6e5f',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
