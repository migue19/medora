'use client';
import { FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/api';

const CRITERIA = [
  { key: 'ratingPunctuality', label: 'Puntualidad' },
  { key: 'ratingTreatment', label: 'Trato del médico' },
  { key: 'ratingFacilities', label: 'Instalaciones' },
] as const;

export type Ratings = Record<(typeof CRITERIA)[number]['key'], number>;

/** Calificación por criterio (1 a 5, con radios accesibles), comentario y opción anónima. */
export function ReviewForm({ publicName, onSubmit, onCancel }: {
  publicName: string;
  onSubmit: (body: Ratings & { comment: string | null; anonymous: boolean }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<Partial<Ratings>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = CRITERIA.every((c) => values[c.key]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!complete) { setError('Califica los tres aspectos.'); return; }
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      await onSubmit({ ...(values as Ratings), comment: String(f.get('comment') ?? '').trim() || null, anonymous: f.get('anonymous') === 'on' });
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <form className="stack" onSubmit={submit}>
      {CRITERIA.map((c) => (
        <fieldset key={c.key} className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 4 }}>
          <legend style={{ fontWeight: 600, fontSize: '.9rem' }}>{c.label}</legend>
          <div className="row" role="radiogroup" aria-label={c.label}>
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="star-option" title={`${n} de 5`}>
                <input type="radio" name={c.key} value={n} checked={values[c.key] === n}
                  onChange={() => setValues({ ...values, [c.key]: n })} className="visually-hidden" />
                <span aria-hidden style={{ fontSize: 28, lineHeight: 1, color: (values[c.key] ?? 0) >= n ? '#d97706' : 'var(--border)', cursor: 'pointer' }}>★</span>
                <span className="visually-hidden">{n} de 5</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <label>Comentario (opcional)
        <textarea name="comment" maxLength={1000} placeholder="¿Qué te pareció la atención? Evita datos personales o de salud de otras personas." />
      </label>
      <label className="check"><input type="checkbox" name="anonymous" />Publicar como «Paciente verificado» en lugar de «{publicName}»</label>
      <p className="small muted">Tu opinión se publica en la página de la clínica. La clínica puede ocultarla si incumple las reglas y te avisará el motivo.</p>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="row">
        <button className="primary" disabled={busy}>{busy ? 'Publicando…' : 'Publicar opinión'}</button>
        {onCancel && <button type="button" onClick={onCancel}>Cancelar</button>}
      </div>
    </form>
  );
}
