import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ServiceWorker } from '@/components/ServiceWorker';

export const metadata: Metadata = {
  title: { default: 'Medora', template: '%s · Medora' },
  description: 'Agenda y reservas de citas médicas en línea para clínicas y consultorios.',
  applicationName: 'Medora',
  appleWebApp: { capable: true, title: 'Medora', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0f766e' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1514' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX">
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
