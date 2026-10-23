'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';

export interface Entry { slug: string; title: string; summary: string; category: string; text: string }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Búsqueda instantánea entre los artículos (todas las palabras deben aparecer). */
export function HelpSearch({ entries }: { entries: Entry[] }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const words = norm(q).split(/\s+/).filter((w) => w.length > 1);
    if (!words.length) return [];
    return entries
      .map((e) => {
        const title = norm(e.title);
        const all = norm(`${e.title} ${e.summary} ${e.text}`);
        if (!words.every((w) => all.includes(w))) return null;
        return { e, score: words.filter((w) => title.includes(w)).length };
      })
      .filter((x): x is { e: Entry; score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [q, entries]);

  return (
    <div className="stack">
      <label className="help-search">
        <span className="sr-only">Buscar en la ayuda</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="¿Qué necesitas? Ej. recordatorios, receta, cobrar anticipo" autoComplete="off" />
      </label>
      {q.trim().length > 1 && (
        <div className="card stack" role="region" aria-live="polite">
          {results.length === 0
            ? <p className="muted" style={{ margin: 0 }}>No encontramos artículos con esas palabras. Escríbenos a contacto@nut.com.mx.</p>
            : results.map(({ e }) => (
              <Link key={e.slug} href={`/ayuda/${e.slug}`} className="help-result">
                <strong>{e.title}</strong><span className="small muted">{e.category} · {e.summary}</span>
              </Link>
            ))}
        </div>
      )}
    </div>
  );
}
