import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { CONTACT_EMAIL, CONTACT_PHONE, CONTACT_TEL, whatsappUrl } from '@/lib/contact';
import { jsonLd, siteUrl } from '@/lib/server-api';
import { ArticleBody } from '../Article';
import { ARTICLES, bySlug } from '../articulos';

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;
export function generateStaticParams() {
  return ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const a = bySlug((await params).slug);
  if (!a) return { title: 'Artículo no encontrado', robots: { index: false } };
  return {
    title: `${a.title} · Ayuda`,
    description: a.summary,
    alternates: { canonical: `${siteUrl()}/ayuda/${a.slug}` },
    openGraph: { title: a.title, description: a.summary, type: 'article' },
  };
}

export default async function Page({ params }: Props) {
  const article = bySlug((await params).slug);
  if (!article) notFound();
  const related = ARTICLES.filter((a) => a.category === article.category && a.slug !== article.slug);
  const steps = article.body.find((b) => 'steps' in b);
  // Datos estructurados: guía paso a paso cuando el artículo tiene pasos.
  const ld = steps && 'steps' in steps ? {
    '@context': 'https://schema.org', '@type': 'HowTo', name: article.title, description: article.summary,
    step: steps.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, text: s.replace(/\*\*/g, '') })),
  } : null;

  return (
    <>
      <Header>
        <Link className="btn ghost" href="/ayuda">Centro de ayuda</Link>
        <Link className="btn" href="/login">Acceso clínica</Link>
      </Header>
      <main className="container section help-article">
        <nav className="small muted" aria-label="Ruta"><Link href="/ayuda">Ayuda</Link> › {article.category}</nav>
        <article className="stack" style={{ marginTop: 8 }}>
          <header className="stack" style={{ gap: 6 }}>
            <h1 style={{ margin: 0 }}>{article.title}</h1>
            <p className="muted" style={{ margin: 0, fontSize: '1.05rem' }}>{article.summary}</p>
          </header>
          <ArticleBody blocks={article.body} />
        </article>
        {related.length > 0 && (
          <aside className="card stack" style={{ marginTop: 32 }} aria-labelledby="relacionados">
            <h2 id="relacionados" style={{ margin: 0 }}>También en «{article.category}»</h2>
            <ul className="help-links">{related.map((a) => <li key={a.slug}><Link href={`/ayuda/${a.slug}`}>{a.title}</Link></li>)}</ul>
          </aside>
        )}
        <p className="small muted" style={{ marginTop: 24 }}>¿Te quedó alguna duda? Escríbenos por <a href={whatsappUrl('Hola, tengo una duda sobre Tepahti.')} target="_blank" rel="noopener">WhatsApp</a>, llámanos al <a href={CONTACT_TEL}>{CONTACT_PHONE}</a> o escribe a <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
      </main>
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />}
    </>
  );
}
