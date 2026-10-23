'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StaffSessionData, errorMessage, staffSession } from '@/lib/api';
import { addDays, fmtDay, money, todayIn } from '@/lib/format';
import type { Doctor } from './shared';

interface Summary {
  totals: { appointments: number; completed: number; noShow: number; cancelled: number; pending: number; noShowRate: number | null; cancellationRate: number | null; occupancy: number | null };
  cancellations: { total: number; byActor: Record<string, number>; lead: { under24h: number; from24to72h: number; over72h: number } };
  origin: { key: string; label: string; count: number }[];
  revenue: { completedCents: number; scheduledCents: number; onlineCollectedCents: number };
  patients: { total: number; new: number; returning: number };
  doctors: { id: string; name: string; availableMinutes: number; bookedMinutes: number; occupancy: number | null; appointments: number; completed: number; noShow: number; noShowRate: number | null; revenueCents: number }[];
  daily: { date: string; scheduled: number; completed: number; noShow: number; cancelled: number }[];
}

const rate = (v: number | null) => (v === null ? '—' : `${v}%`);
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
function monthEnd(d: string) {
  const [y, m] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Indicadores del periodo para propietario y administración. */
export function Reports({ session }: { session: StaffSessionData }) {
  const tz = session.clinic.timezone;
  const today = todayIn(tz);
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(monthEnd(today));
  const [doctorId, setDoctorId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<Summary | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    staffSession.get<Doctor[]>('/api/clinic/doctors').then(setDoctors).catch(() => undefined);
    staffSession.get<{ id: string; name: string }[]>('/api/clinic/locations').then(setLocations).catch(() => undefined);
  }, []);
  const query = useMemo(() => {
    const q = new URLSearchParams({ from, to });
    if (doctorId) q.set('doctorId', doctorId);
    if (locationId) q.set('locationId', locationId);
    return q.toString();
  }, [from, to, doctorId, locationId]);
  const load = useCallback(() => staffSession.get<Summary>(`/api/clinic/reports/summary?${query}`).then(setData)
    .catch((e) => setMsg({ ok: false, text: errorMessage(e) })), [query]);
  useEffect(() => { setData(null); void load(); }, [load]);

  async function download(format: 'csv' | 'xlsx') {
    setMsg(null);
    try {
      const res = await staffSession.raw('GET', `/api/clinic/reports/export/${format}?${query}`);
      const url = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement('a'), { href: url, download: `citas-${from}-a-${to}.${format}` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); }
  }

  const preset = (f: string, t: string) => { setFrom(f); setTo(t); };
  const lastMonth = addDays(monthStart(today), -1);

  return (
    <div className="stack">
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label>Desde<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} /></label>
        <label>Hasta<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} /></label>
        <label>Médico<select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Todos</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}</select></label>
        {locations.length > 1 && <label>Sede<select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Todas</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
        <div className="row">
          <button className="ghost small" onClick={() => preset(monthStart(today), monthEnd(today))}>Este mes</button>
          <button className="ghost small" onClick={() => preset(monthStart(lastMonth), lastMonth)}>Mes pasado</button>
          <button className="ghost small" onClick={() => preset(addDays(today, -6), today)}>Últimos 7 días</button>
        </div>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="status">{msg.text}</div>}
      {!data ? <p className="muted">Calculando…</p> : (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
            <Tile label="Citas" value={String(data.totals.appointments)} note={`${data.totals.completed} atendidas · ${data.totals.pending} por atender`} />
            <Tile label="Inasistencia" value={rate(data.totals.noShowRate)} note={`${data.totals.noShow} no asistieron`} />
            <Tile label="Cancelaciones" value={rate(data.totals.cancellationRate)} note={`${data.totals.cancelled} canceladas`} />
            <Tile label="Ocupación de la agenda" value={rate(data.totals.occupancy)} note="tiempo agendado / horario" />
            <Tile label="Pacientes nuevos" value={String(data.patients.new)} note={`${data.patients.returning} recurrentes`} />
            <Tile label="Ingresos (atendidas)" value={money(data.revenue.completedCents)} note={`${money(data.revenue.onlineCollectedCents)} cobrado en línea`} />
          </div>

          <div className="card stack">
            <div className="row">
              <h3 style={{ margin: 0 }}>Citas por día</h3>
              <span className="spacer" />
              <button className="ghost small" aria-pressed={showTable} onClick={() => setShowTable(!showTable)}>{showTable ? 'Ver gráfica' : 'Ver tabla'}</button>
            </div>
            {showTable ? <DailyTable rows={data.daily} /> : <DailyChart rows={data.daily} />}
          </div>

          <div className="grid">
            <div className="card stack">
              <h3 style={{ margin: 0 }}>Origen de las citas</h3>
              {data.origin.length === 0 ? <p className="small muted">Sin citas en el periodo.</p> : <HBars rows={data.origin.map((o) => ({ label: o.label, value: o.count }))} />}
            </div>
            <div className="card stack">
              <h3 style={{ margin: 0 }}>Cancelaciones</h3>
              {data.cancellations.total === 0 ? <p className="small muted">Ninguna en el periodo.</p> : (
                <>
                  <HBars rows={[
                    { label: 'Menos de 24 h antes', value: data.cancellations.lead.under24h },
                    { label: 'De 24 a 72 h antes', value: data.cancellations.lead.from24to72h },
                    { label: 'Más de 72 h antes', value: data.cancellations.lead.over72h },
                  ]} />
                  <p className="small muted" style={{ margin: 0 }}>
                    Canceló el paciente: {data.cancellations.byActor.PATIENT ?? 0} · la clínica: {data.cancellations.byActor.STAFF ?? 0}
                    {data.cancellations.byActor.SYSTEM ? ` · por falta de pago: ${data.cancellations.byActor.SYSTEM}` : ''}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="card table-wrap">
            <h3>Por médico</h3>
            <table>
              <thead><tr><th>Médico</th><th>Citas</th><th>Atendidas</th><th>Inasistencia</th><th>Ocupación</th><th>Ingresos</th></tr></thead>
              <tbody>
                {data.doctors.length === 0 && <tr><td colSpan={6} className="muted">Sin médicos con horario en el periodo.</td></tr>}
                {data.doctors.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td><td>{d.appointments}</td><td>{d.completed}</td><td>{rate(d.noShowRate)}</td>
                    <td>
                      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }} title={`${Math.round(d.bookedMinutes / 60)} h agendadas de ${Math.round(d.availableMinutes / 60)} h de horario`}>
                        <span style={{ width: 80, height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden', flexShrink: 0 }}>
                          <span style={{ display: 'block', height: '100%', width: `${Math.min(100, d.occupancy ?? 0)}%`, background: 'var(--primary)', borderRadius: 4 }} />
                        </span>
                        <span className="small">{rate(d.occupancy)}</span>
                      </div>
                    </td>
                    <td>{money(d.revenueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row">
            <button onClick={() => download('xlsx')}>Descargar Excel</button>
            <button onClick={() => download('csv')}>Descargar CSV</button>
            <button className="ghost" onClick={async () => {
              setMsg(null);
              try { const r = await staffSession.post<{ sentTo: string }>('/api/clinic/reports/weekly-preview', {}); setMsg({ ok: true, text: `Te enviamos el resumen de la semana pasada a ${r.sentTo}.` }); }
              catch (e) { setMsg({ ok: false, text: errorMessage(e) }); }
            }}>Enviarme el resumen semanal</button>
          </div>
          <details className="small muted">
            <summary>¿Cómo se calcula?</summary>
            <ul style={{ paddingLeft: 18 }}>
              <li><strong>Citas</strong>: las del periodo por fecha de la cita, sin canceladas ni apartados sin pagar.</li>
              <li><strong>Inasistencia</strong>: «no asistió» entre las citas con resultado registrado (atendidas + no asistió).</li>
              <li><strong>Cancelaciones</strong>: canceladas entre todas las citas del periodo; la anticipación se mide desde que se canceló hasta la hora de la cita.</li>
              <li><strong>Ocupación</strong>: minutos de citas (agendadas, atendidas y no asistió) entre los minutos del horario del médico, sin días bloqueados.</li>
              <li><strong>Pacientes nuevos</strong>: su primera cita en la clínica cae en el periodo; los demás son recurrentes.</li>
              <li><strong>Ingresos</strong>: precio de las citas atendidas. <strong>Cobrado en línea</strong>: pagos con tarjeta, OXXO o SPEI del periodo, menos reembolsos.</li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card stack" style={{ gap: 2 }}>
      <span className="small muted">{label}</span>
      <strong style={{ fontSize: '1.6rem', fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
      <span className="small muted">{note}</span>
    </div>
  );
}

/** Barras horizontales de una sola serie: la longitud es la cantidad; etiqueta y valor en tinta de texto. */
function HBars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rows.map((r) => (
        <div key={r.label} className="stack" style={{ gap: 2 }} title={`${r.label}: ${r.value}`}>
          <div className="row small" style={{ justifyContent: 'space-between' }}><span>{r.label}</span><strong style={{ fontVariantNumeric: 'tabular-nums' }}>{r.value}</strong></div>
          <span style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${(r.value / max) * 100}%`, minWidth: r.value ? 4 : 0, background: 'var(--primary)', borderRadius: 4 }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Columnas por día (citas agendadas), con eje recesivo y detalle al pasar el cursor. */
function DailyChart({ rows }: { rows: Summary['daily'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.scheduled));
  const ticks = [0, Math.ceil(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  const W = 960; const H = 190; const left = 28; const bottom = 22; const top = 8;
  const plotW = W - left - 4; const plotH = H - bottom - top;
  const bw = plotW / rows.length;
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const every = Math.ceil(rows.length / 10);
  const h = hover !== null ? rows[hover] : null;
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Citas agendadas por día" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - 4} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{t}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = left + i * bw;
          const barW = Math.max(2, Math.min(28, bw - 2));
          const hgt = (r.scheduled / max) * plotH;
          return (
            <g key={r.date} onMouseEnter={() => setHover(i)}>
              <rect x={x} y={top} width={bw} height={plotH} fill="transparent" />
              {r.scheduled > 0 && (
                <path d={`M${x + (bw - barW) / 2},${top + plotH} v${-(hgt - Math.min(4, hgt))} q0,${-Math.min(4, hgt)} ${Math.min(4, barW / 2)},${-Math.min(4, hgt)} h${barW - 2 * Math.min(4, barW / 2)} q${Math.min(4, barW / 2)},0 ${Math.min(4, barW / 2)},${Math.min(4, hgt)} v${hgt - Math.min(4, hgt)} z`}
                  fill="var(--primary)" opacity={hover === null || hover === i ? 1 : 0.55} />
              )}
              {i % every === 0 && <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--muted)">{Number(r.date.slice(8))}</text>}
            </g>
          );
        })}
      </svg>
      {h && (
        <div className="card small" role="status" style={{ position: 'absolute', top: 0, right: 0, padding: '6px 10px', pointerEvents: 'none' }}>
          <strong>{fmtDay(h.date)}</strong><br />{h.scheduled} citas · {h.completed} atendidas · {h.noShow} no asistió · {h.cancelled} canceladas
        </div>
      )}
    </div>
  );
}

function DailyTable({ rows }: { rows: Summary['daily'] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Día</th><th>Citas</th><th>Atendidas</th><th>No asistió</th><th>Canceladas</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.date}><td>{fmtDay(r.date)}</td><td>{r.scheduled}</td><td>{r.completed}</td><td>{r.noShow}</td><td>{r.cancelled}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
