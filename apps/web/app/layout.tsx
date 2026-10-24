import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { ServiceWorker } from '@/components/ServiceWorker';

// Tipografía de la marca, servida desde el propio sitio (next/font la descarga al compilar).
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], display: 'swap', variable: '--font-jakarta' });

export const metadata: Metadata = {
  title: { default: 'Tepahti', template: '%s · Tepahti' },
  description: 'Agenda y reservas de citas médicas en línea para clínicas y consultorios.',
  applicationName: 'Tepahti',
  appleWebApp: { capable: true, title: 'Tepahti', statusBarStyle: 'default' },
  icons: { icon: [{ url: '/brand/icon.svg', type: 'image/svg+xml' }, { url: '/icons/icon-192.png' }], apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0b6e5f' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1715' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX" className={jakarta.variable}>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
