'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { errorMessage, staffSession } from '@/lib/api';
import { money } from '@/lib/format';
import type { Doctor, Location, Service } from './shared';

const VISIT_LABEL: Record<string, string> = { ANY: 'Cualquiera', FIRST: 'Sólo primera vez', FOLLOW_UP: 'Sólo subsecuente' };

function toCents(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function Services() {
  const [services, setServices] = useState<Service[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [pricing, setPricing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => staffSession.get<Service[]>('/api/clinic/services').then(setServices).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { void load(); }, [load]);

  async function save(e: FormEvent<HTMLFormElement>, s?: Service) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const priceCents = toCents(f.get('price'));
    if (priceCents === null) { setError('Precio inválido'); return; }
    const body: Record<string, unknown> = {
      name: f.get('name'), durationMinutes: Number(f.get('duration')), priceCents, visitType: f.get('visitType'),
      telemedicine: f.get('telemedicine') === 'on',
    };
    if (s) body.active = f.get('active') === 'on';
    setError(null);
    try {
      if (s) await staffSession.patch(`/api/clinic/services/${s.id}`, body);
      else { await staffSession.post('/api/clinic/services', body); e.currentTarget?.reset(); }
      setEditing(null);
      await load();
    } catch (err) { setError(errorMessage(err)); }
  }

  const fields = (s?: Service) => (
    <>
      <label>Nombre<input name="name" required minLength={2} maxLength={120} defaultValue={s?.name} placeholder="Consulta de primera vez" /></label>
      <label>Duración (min)<input name="duration" type="number" required min={5} max={480} step={5} defaultValue={s?.durationMinutes ?? 30} /></label>
      <label>Precio base MXN<input name="price" required inputMode="decimal" defaultValue={s ? (s.priceCents / 100).toFixed(2) : ''} placeholder="600.00" /></label>
      <label>Para
        <select name="visitType" defaultValue={s?.visitType ?? 'ANY'}>
          {Object.entries(VISIT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="check"><input type="checkbox" name="telemedicine" defaultChecked={s?.telemedicine ?? false} />También por videoconsulta</label>
    </>
  );

  return (
    <div className="stack">
      <p className="muted">Los servicios definen la duración de cada cita. Cambiar precio o duración no altera las citas ya agendadas. «Sólo primera vez» y «Sólo subsecuente» se aplican a las reservas en línea según las citas atendidas con ese médico.</p>
      {error && <div className="alert error">{error}</div>}
      <form className="card stack" onSubmit={(e) => save(e)}>
        <h3>Nuevo servicio</h3>
        <div className="grid">{fields()}</div>
        <div><button className="primary">Agregar</button></div>
      </form>
      <div className="table-wrap card">
        <table>
          <thead><tr><th>Servicio</th><th>Duración</th><th>Precio base</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {services.map((s) => pricing === s.id ? (
              <tr key={s.id}><td colSpan={5}><PriceEditor service={s} onClose={() => setPricing(null)} /></td></tr>
            ) : editing === s.id ? (
              <tr key={s.id}><td colSpan={5}>
                <form className="stack" onSubmit={(e) => save(e, s)}>
                  <div className="grid">{fields(s)}</div>
                  <label className="check"><input type="checkbox" name="active" defaultChecked={s.active} />Activo</label>
                  <div className="row"><button className="primary">Guardar</button><button type="button" onClick={() => setEditing(null)}>Cancelar</button></div>
                </form>
              </td></tr>
            ) : (
              <tr key={s.id}>
                <td>{s.name}{s.visitType !== 'ANY' && <div className="small muted">{VISIT_LABEL[s.visitType]}</div>}{s.telemedicine && <div className="small muted">Videoconsulta</div>}</td>
                <td>{s.durationMinutes} min</td><td>{money(s.priceCents)}</td>
                <td>{s.active ? 'Activo' : <span className="muted">Inactivo</span>}</td>
                <td><div className="row"><button className="ghost" onClick={() => setEditing(s.id)}>Editar</button>
                  <button className="ghost" onClick={() => setPricing(s.id)}>Precios</button></div></td>
              </tr>
            ))}
            {services.length === 0 && <tr><td colSpan={5} className="muted">Aún no hay servicios.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface Price { doctorId: string | null; locationId: string | null; priceCents: number }
interface PriceRow { doctorId: string; locationId: string; price: string }

/** Precios especiales: por sede, por médico o por médico en una sede (gana el más específico). */
function PriceEditor({ service, onClose }: { service: Service; onClose: () => void }) {
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    Promise.all([
      staffSession.get<Price[]>(`/api/clinic/services/${service.id}/prices`),
      staffSession.get<Doctor[]>('/api/clinic/doctors'),
      staffSession.get<Location[]>('/api/clinic/locations'),
    ]).then(([p, d, l]) => {
      setRows(p.map((x) => ({ doctorId: x.doctorId ?? '', locationId: x.locationId ?? '', price: (x.priceCents / 100).toFixed(2) })));
      setDoctors(d.filter((x) => x.serviceIds.includes(service.id)));
      setLocations(l);
    }).catch((e) => setMsg({ ok: false, text: errorMessage(e) }));
  }, [service.id]);

  async function save() {
    const prices = rows.map((r) => ({ doctorId: r.doctorId || null, locationId: r.locationId || null, priceCents: toCents(r.price) }));
    if (prices.some((p) => p.priceCents === null)) { setMsg({ ok: false, text: 'Revisa los precios.' }); return; }
    setMsg(null);
    try {
      await staffSession.put(`/api/clinic/services/${service.id}/prices`, { prices });
      setMsg({ ok: true, text: 'Precios guardados. Aplican a las citas nuevas.' });
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); }
  }

  const set = (i: number, patch: Partial<PriceRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="stack">
      <strong>Precios especiales de «{service.name}» (base {money(service.priceCents)})</strong>
      <p className="small muted">Gana el más específico: médico en una sede, luego médico en cualquier sede, luego sede para todos los médicos y, si no hay ninguno, el precio base.</p>
      {rows.map((r, i) => (
        <div key={i} className="row">
          <select value={r.locationId} onChange={(e) => set(i, { locationId: e.target.value })} style={{ width: 'auto' }}>
            <option value="">Todas las sedes</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select value={r.doctorId} onChange={(e) => set(i, { doctorId: e.target.value })} style={{ width: 'auto' }}>
            <option value="">Todos los médicos</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
          </select>
          <input value={r.price} inputMode="decimal" onChange={(e) => set(i, { price: e.target.value })} style={{ width: 120 }} placeholder="700.00" />
          <button className="ghost" aria-label="Quitar" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="row">
        <button onClick={() => setRows([...rows, { doctorId: '', locationId: locations[0]?.id ?? '', price: (service.priceCents / 100).toFixed(2) }])}>+ Precio especial</button>
        <button className="primary" onClick={save}>Guardar precios</button>
        <button onClick={onClose}>Cerrar</button>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
    </div>
  );
}
