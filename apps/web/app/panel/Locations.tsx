'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { errorMessage, staffSession } from '@/lib/api';
import { WEEKDAYS, hhmmToMinutes, minutesToHHMM, weeklyLabel } from '@/lib/format';
import type { Hours, Location } from './shared';

/** Sedes de la clínica: datos, mapa, horario de atención y consultorios. */
export function Locations() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => staffSession.get<Location[]>('/api/clinic/locations').then(setLocations).catch((e) => setMsg({ ok: false, text: errorMessage(e) })), []);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); await load(); return true; } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); return false; }
  }

  return (
    <div className="card stack">
      <div className="row"><h3 style={{ margin: 0 }}>Sedes y consultorios</h3><span className="spacer" />
        {editing === null && <button onClick={() => setEditing('new')}>+ Agregar sede</button>}</div>
      <p className="small muted">Cada bloque del horario de un médico pertenece a una sede y, si quieres, a un consultorio. Un consultorio nunca tiene dos citas a la vez.</p>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="status">{msg.text}</div>}
      {editing === 'new' && (
        <LocationForm onCancel={() => setEditing(null)}
          onSave={async (body) => { if (await run(() => staffSession.post('/api/clinic/locations', body), 'Sede creada.')) setEditing(null); }} />
      )}
      {locations.map((l) => (
        <div key={l.id} className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, opacity: l.active ? 1 : 0.6 }}>
          {editing === l.id ? (
            <LocationForm location={l} onCancel={() => setEditing(null)}
              onSave={async (body) => { if (await run(() => staffSession.patch(`/api/clinic/locations/${l.id}`, body), 'Sede actualizada.')) setEditing(null); }} />
          ) : (
            <div className="row">
              <div className="stack" style={{ gap: 2, flex: 1 }}>
                <strong>{l.name} {!l.active && <span className="badge">Inactiva</span>}</strong>
                <span className="small muted">{[l.address, l.neighborhood, l.city, l.phone].filter(Boolean).join(' · ') || 'Sin dirección'}{l.mapUrl ? <> · <a href={l.mapUrl} target="_blank" rel="noreferrer">Mapa</a></> : null}</span>
                {!l.city && <span className="small" style={{ color: 'var(--warn)' }}>Agrega la ciudad para aparecer en las búsquedas por zona del directorio.</span>}
              </div>
              <button className="ghost" onClick={() => setEditing(l.id)}>Editar</button>
              <button className="ghost" onClick={() => run(() => staffSession.patch(`/api/clinic/locations/${l.id}`, { active: !l.active }), l.active ? 'Sede desactivada.' : 'Sede activada.')}>{l.active ? 'Desactivar' : 'Activar'}</button>
            </div>
          )}
          <HoursEditor location={l} onSave={(hours) => run(() => staffSession.put(`/api/clinic/locations/${l.id}/hours`, { hours }), `Horario de ${l.name} guardado.`)} />
          <div className="row">
            <span className="small" style={{ fontWeight: 600 }}>Consultorios:</span>
            {l.rooms.length === 0 && <span className="small muted">ninguno</span>}
            {l.rooms.map((r) => (
              <button key={r.id} className="small" title={r.active ? 'Desactivar' : 'Activar'} style={{ opacity: r.active ? 1 : 0.55 }}
                onClick={() => run(() => staffSession.patch(`/api/clinic/rooms/${r.id}`, { active: !r.active }), r.active ? `${r.name} desactivado.` : `${r.name} activado.`)}>
                {r.name}{r.active ? '' : ' (inactivo)'}
              </button>
            ))}
            <RoomAdder onAdd={(name) => run(() => staffSession.post(`/api/clinic/locations/${l.id}/rooms`, { name }), `Consultorio ${name} agregado.`)} />
          </div>
        </div>
      ))}
    </div>
  );
}

function LocationForm({ location, onSave, onCancel }: { location?: Location; onSave: (body: object) => void; onCancel: () => void }) {
  const [coordsError, setCoordsError] = useState<string | null>(null);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const coords = String(f.get('coords') ?? '').trim();
    const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(coords);
    if (coords && !m) { setCoordsError('Escribe latitud y longitud separadas por coma, p. ej. 19.3867, -99.1656'); return; }
    onSave({
      name: f.get('name'), address: f.get('address'), phone: f.get('phone'), mapUrl: f.get('mapUrl'),
      neighborhood: f.get('neighborhood'), city: f.get('city'), state: f.get('state'), postalCode: f.get('postalCode'),
      // Vacío: se toman del enlace del mapa si las trae (o se borran).
      ...(m ? { latitude: Number(m[1]), longitude: Number(m[2]) } : location?.latitude != null && !f.get('mapUrl') ? { latitude: null, longitude: null } : {}),
    });
  }
  return (
    <form className="stack" onSubmit={submit}>
      <div className="grid">
        <label>Nombre<input name="name" required minLength={2} maxLength={120} defaultValue={location?.name} placeholder="Sede Norte" /></label>
        <label>Dirección<input name="address" maxLength={240} defaultValue={location?.address ?? ''} /></label>
        <label>Teléfono<input name="phone" maxLength={30} inputMode="tel" defaultValue={location?.phone ?? ''} /></label>
        <label>Enlace del mapa<input name="mapUrl" type="url" maxLength={500} pattern="https://.*" defaultValue={location?.mapUrl ?? ''} placeholder="https://maps.app.goo.gl/…" /></label>
        <label>Colonia<input name="neighborhood" maxLength={80} defaultValue={location?.neighborhood ?? ''} /></label>
        <label>Ciudad o alcaldía<input name="city" maxLength={80} defaultValue={location?.city ?? ''} placeholder="Ciudad de México" /></label>
        <label>Estado<input name="state" maxLength={60} defaultValue={location?.state ?? ''} /></label>
        <label>Código postal<input name="postalCode" maxLength={5} inputMode="numeric" pattern="\d{5}" defaultValue={location?.postalCode ?? ''} /></label>
        <label>Coordenadas (para «cerca de mí»)
          <input name="coords" maxLength={40} placeholder="19.3867, -99.1656" onChange={() => setCoordsError(null)}
            defaultValue={location?.latitude != null ? `${location.latitude}, ${location.longitude}` : ''} />
        </label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Coordenadas: en Google Maps, clic derecho sobre la sede y copia los números. Si pegas el enlace largo del mapa, se toman solas.</p>
      {coordsError && <div className="alert error small">{coordsError}</div>}
      <div className="row"><button className="primary">Guardar</button><button type="button" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}

function RoomAdder({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onAdd(name.trim()); setName(''); } }}>
      <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Consultorio 3" style={{ width: 150 }} />
      <button disabled={!name.trim()}>Agregar</button>
    </form>
  );
}

interface Row { weekday: number; start: string; end: string }

function HoursEditor({ location, onSave }: { location: Location; onSave: (hours: Hours[]) => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    setRows(location.hours.map((h) => ({ weekday: h.weekday, start: minutesToHHMM(h.startMinute), end: minutesToHHMM(h.endMinute) })));
  }, [location]);
  const summary = location.hours.length
    ? weeklyLabel(location.hours)
    : 'Sin horario de atención definido (no se restringen los horarios de los médicos)';
  if (!open) return <div className="row"><span className="small muted" style={{ flex: 1 }}>{summary}</span><button className="ghost small" onClick={() => setOpen(true)}>Horario de atención</button></div>;
  return (
    <div className="stack">
      {WEEKDAYS.map((name, i) => {
        const weekday = i + 1;
        const day = rows.map((r, idx) => ({ r, idx })).filter(({ r }) => r.weekday === weekday);
        return (
          <div key={weekday} className="row">
            <strong className="small" style={{ width: 90 }}>{name}</strong>
            {day.length === 0 && <span className="small muted">Cerrado</span>}
            {day.map(({ r, idx }) => (
              <span key={idx} className="row">
                <input type="time" step={300} value={r.start} style={{ width: 'auto' }} onChange={(e) => setRows(rows.map((x, j) => (j === idx ? { ...x, start: e.target.value } : x)))} />
                a
                <input type="time" step={300} value={r.end} style={{ width: 'auto' }} onChange={(e) => setRows(rows.map((x, j) => (j === idx ? { ...x, end: e.target.value } : x)))} />
                <button className="ghost" aria-label="Quitar" onClick={() => setRows(rows.filter((_, j) => j !== idx))}>✕</button>
              </span>
            ))}
            <button className="ghost small" onClick={() => setRows([...rows, { weekday, start: '09:00', end: '19:00' }])}>+</button>
          </div>
        );
      })}
      <div className="row">
        <button className="primary" onClick={() => {
          const hours = rows.map((r) => ({ weekday: r.weekday, startMinute: hhmmToMinutes(r.start)!, endMinute: hhmmToMinutes(r.end === '00:00' ? '24:00' : r.end)! }));
          onSave(hours); setOpen(false);
        }}>Guardar horario</button>
        <button onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </div>
  );
}
