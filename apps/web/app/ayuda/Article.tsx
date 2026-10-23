import type { Block } from './articulos';

/** Texto con **negritas** (el contenido es nuestro, no del usuario). */
export function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/).map((part, i) => (part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part))}</>;
}

export function ArticleBody({ blocks }: { blocks: Block[] }) {
  return (
    <div className="help-body stack">
      {blocks.map((b, i) => {
        if ('h' in b) return <h2 key={i}>{b.h}</h2>;
        if ('p' in b) return <p key={i}><Rich text={b.p} /></p>;
        if ('steps' in b) return <ol key={i} className="help-steps">{b.steps.map((s, j) => <li key={j}><Rich text={s} /></li>)}</ol>;
        if ('list' in b) return <ul key={i}>{b.list.map((s, j) => <li key={j}><Rich text={s} /></li>)}</ul>;
        if ('tip' in b) return <div key={i} className="help-tip"><strong>Consejo</strong><span><Rich text={b.tip} /></span></div>;
        return (
          <figure key={i} className={`help-shot${b.mobile ? ' mobile' : ''}`}>
            {/* Capturas ya optimizadas (JPEG ~100 KB): se sirven tal cual, sin el optimizador de imágenes. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/ayuda/${b.img}.jpg`} alt={b.alt} width={b.mobile ? 780 : 1650} height={b.mobile ? 1520 : 1050} loading="lazy" decoding="async" />
            <figcaption className="small muted">{b.alt}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}
