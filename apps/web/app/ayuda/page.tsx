import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { CONTACT_EMAIL, CONTACT_PHONE, CONTACT_TEL, whatsappUrl } from '@/lib/contact';
import { siteUrl } from '@/lib/server-api';
import { ARTICLES, CATEGORIES } from './articulos';
import { HelpSearch } from './HelpSearch';

export const metadata: Metadata = {
  title: 'Centro de ayuda',
  description: 'Guías paso a paso de Tepahti: agenda y reservas en línea, recordatorios, expediente clínico, recetas, cobros, videoconsultas y reportes.',
  alternates: { canonical: `${siteUrl()}/ayuda` },
};

const plain = (blocks: (typeof ARTICLES)[number]['body']) =>
  blocks.map((b) => ('p' in b ? b.p : 'h' in b ? b.h : 'tip' in b ? b.tip : 'steps' in b ? b.steps.join(' ') : 'list' in b ? b.list.join(' ') : b.alt))
    .join(' ').replace(/\*\*/g, '');

export default function Page() {
  const entries = ARTICLES.map((a) => ({ slug: a.slug, title: a.title, summary: a.summary, category: a.category, text: plain(a.body) }));
  return (
    <>
      <Header>
        <Link className="btn ghost" href="/directorio">Buscar médico</Link>
        <Link className="btn" href="/login">Acceso clínica</Link>
      </Header>
      <main className="container section stack" style={{ gap: 24 }}>
        <section className="stack help-hero">
          <h1>Centro de ayuda</h1>
          <p className="muted" style={{ margin: 0 }}>Guías paso a paso para sacarle provecho a Tepahti en tu clínica.</p>
          <HelpSearch entries={entries} />
        </section>
        <div className="help-grid">
          {CATEGORIES.map((c) => (
            <section key={c.name} className="card stack" aria-labelledby={`cat-${c.name}`}>
              <div>
                <h2 id={`cat-${c.name}`} style={{ marginBottom: 4 }}>{c.name}</h2>
                <p className="small muted" style={{ margin: 0 }}>{c.description}</p>
              </div>
              <ul className="help-links">
                {ARTICLES.filter((a) => a.category === c.name).map((a) => (
                  <li key={a.slug}><Link href={`/ayuda/${a.slug}`}>{a.title}</Link></li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="small muted">¿No encontraste lo que buscabas? Escríbenos por <a href={whatsappUrl('Hola, tengo una duda sobre Tepahti.')} target="_blank" rel="noopener">WhatsApp</a>, llámanos al <a href={CONTACT_TEL}>{CONTACT_PHONE}</a> o escribe a <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
      </main>
    </>
  );
}
