'use client';
import { useEffect, useState } from 'react';
import { addDays, fmtDay } from '@/lib/format';
import { errorMessage } from '@/lib/api';

export interface DaySlots { date: string; slots: { startsAt: string; endsAt: string; time: string }[] }
export interface Availability { timezone: string; days: DaySlots[]; bookingEnabled?: boolean }

interface Props {
  startDate: string;
  load: (from: string) => Promise<Availability>;
  selected: string | null;
  onSelect: (startsAt: string, time: string, date: string) => void;
  reloadKey?: number;
}

const WINDOW = 7;

export function SlotPicker({ startDate, load, selected, onSelect, reloadKey = 0 }: Props) {
  const [from, setFrom] = useState(startDate);
  const [data, setData] = useState<Availability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setFrom(startDate); }, [startDate]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    load(from)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(errorMessage(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, load, reloadKey]);

  const total = data?.days.reduce((n, d) => n + d.slots.length, 0) ?? 0;

  return (
    <div className="stack">
      <div className="row">
        <button type="button" onClick={() => setFrom(addDays(from, -WINDOW))} disabled={from <= startDate || loading}>← Anterior</button>
        <span className="muted small" style={{ flex: 1, textAlign: 'center' }}>
          {fmtDay(from, { day: 'numeric', month: 'short' })} – {fmtDay(addDays(from, WINDOW - 1), { day: 'numeric', month: 'short' })}
        </span>
        <button type="button" onClick={() => setFrom(addDays(from, WINDOW))} disabled={loading}>Siguiente →</button>
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
      {data?.bookingEnabled === false && <div className="alert warn">La clínica no está recibiendo reservas en línea por ahora.</div>}
      {loading && !data && <p className="muted">Cargando horarios…</p>}
      {data && (
        <div className="days" aria-busy={loading}>
          {data.days.map((d) => (
            <div key={d.date} className="day">
              <h4>{fmtDay(d.date)}</h4>
              {d.slots.length === 0 ? <p className="muted small">Sin horarios</p> : (
                <div className="slots">
                  {d.slots.map((s) => (
                    <button
                      key={s.startsAt} type="button" className="slot" aria-pressed={selected === s.startsAt}
                      onClick={() => onSelect(s.startsAt, s.time, d.date)}
                    >{s.time}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {data && total === 0 && !loading && data.bookingEnabled !== false && (
        <p className="muted small">No hay horarios disponibles en estos días. Prueba la semana siguiente.</p>
      )}
    </div>
  );
}
