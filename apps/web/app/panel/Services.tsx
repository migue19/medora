'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { errorMessage, staffSession } from '@/lib/api';
import { money } from '@/lib/format';
import type { Service } from './shared';

function toCents(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function Services() {
  const [services, setServices] = useState<Service[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => staffSession.get<Service[]>('/api/clinic/services').then(setServices).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { void load(); }, [load]);

  async function save(e: FormEvent<HTMLFormElement>, s?: Service) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const priceCents = toCents(f.get('price'));
    if (priceCents === null) { setError('Precio inválido'); return; }
    const body: Record<string, unknown> = { name: f.get('name'), durationMinutes: Number(f.get('duration')), priceCents };
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
      <label>Precio MXN<input name="price" required inputMode="decimal" defaultValue={s ? (s.priceCents / 100).toFixed(2) : ''} placeholder="600.00" /></label>
    </>
  );

  return (
    <div className="stack">
      <p className="muted">Los servicios definen la duración de cada cita. Cambiar precio o duración no altera las citas ya agendadas.</p>
      {error && <div className="alert error">{error}</div>}
      <form className="card stack" onSubmit={(e) => save(e)}>
        <h3>Nuevo servicio</h3>
        <div className="grid">{fields()}</div>
        <div><button className="primary">Agregar</button></div>
      </form>
      <div className="table-wrap card">
        <table>
          <thead><tr><th>Servicio</th><th>Duración</th><th>Precio</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {services.map((s) => editing === s.id ? (
              <tr key={s.id}><td colSpan={5}>
                <form className="stack" onSubmit={(e) => save(e, s)}>
                  <div className="grid">{fields(s)}</div>
                  <label className="check"><input type="checkbox" name="active" defaultChecked={s.active} />Activo</label>
                  <div className="row"><button className="primary">Guardar</button><button type="button" onClick={() => setEditing(null)}>Cancelar</button></div>
                </form>
              </td></tr>
            ) : (
              <tr key={s.id}>
                <td>{s.name}</td><td>{s.durationMinutes} min</td><td>{money(s.priceCents)}</td>
                <td>{s.active ? 'Activo' : <span className="muted">Inactivo</span>}</td>
                <td><button className="ghost" onClick={() => setEditing(s.id)}>Editar</button></td>
              </tr>
            ))}
            {services.length === 0 && <tr><td colSpan={5} className="muted">Aún no hay servicios.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
