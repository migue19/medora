/** Estrellas de solo lectura (con texto para lectores de pantalla). */
export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span role="img" aria-label={`${value.toFixed(1)} de 5 estrellas`} style={{ position: 'relative', display: 'inline-block', fontSize: size, lineHeight: 1, letterSpacing: 1 }}>
      <span aria-hidden style={{ color: 'var(--border)' }}>★★★★★</span>
      <span aria-hidden style={{ position: 'absolute', inset: 0, width: `${pct}%`, overflow: 'hidden', whiteSpace: 'nowrap', color: '#d97706' }}>★★★★★</span>
    </span>
  );
}

export function RatingSummaryLine({ rating }: { rating: { average: number; count: number } | null }) {
  if (!rating || rating.count === 0) return null;
  return (
    <span className="small row" style={{ gap: 6 }}>
      <Stars value={rating.average} /> <strong>{rating.average.toFixed(1)}</strong>
      <span className="muted">({rating.count} {rating.count === 1 ? 'opinión verificada' : 'opiniones verificadas'})</span>
    </span>
  );
}
