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
  // Oscuro por defecto; ThemeToggle y THEME_SCRIPT lo ajustan al tema elegido.
  themeColor: '#0e1715',
  width: 'device-width',
  initialScale: 1,
};

// Antes de pintar: aplica el tema guardado en este navegador (oscuro si no hay). El widget incrustado en sitios
// de clínicas sigue el tema del sistema, para no desentonar con la página que lo contiene.
const THEME_SCRIPT = `try{var t=localStorage.getItem('tema');if(location.pathname.indexOf('/embed')===0)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';if(t==='light'){document.documentElement.dataset.theme='light';var m=document.querySelector('meta[name="theme-color"]');if(m)m.content='#0b6e5f'}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX" className={jakarta.variable} data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
