import type { NextConfig } from 'next';

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:6010';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

// Nada se puede mostrar dentro de otro sitio salvo /embed/*, que es la reserva del widget.
const noFraming = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
];
const embedFraming = [{ key: 'Content-Security-Policy', value: 'frame-ancestors *' }];

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // Proxy de mismo origen: el navegador sólo habla con la web y las cookies de refresh quedan en este origen.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/:path((?!embed/).*)', headers: noFraming },
      { source: '/embed/:path*', headers: embedFraming },
      // Excepciones al Permissions-Policy (la última regla que coincide gana): «Cerca de mí» del directorio
      // y la cámara y el micrófono de la videoconsulta, delegados sólo a la sala de Daily.
      { source: '/directorio/:path*', headers: [{ key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' }] },
      { source: '/directorio', headers: [{ key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' }] },
      {
        source: '/consulta',
        headers: [{
          key: 'Permissions-Policy',
          value: 'camera=(self "https://*.daily.co"), microphone=(self "https://*.daily.co"), display-capture=(self "https://*.daily.co"), autoplay=(self "https://*.daily.co"), geolocation=()',
        }],
      },
      { source: '/widget.js', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }] },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ];
  },
};

export default nextConfig;
