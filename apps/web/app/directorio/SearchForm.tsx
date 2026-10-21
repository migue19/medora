'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const WHEN = [{ v: '', l: 'Cualquier fecha' }, { v: 'hoy', l: 'Hoy' }, { v: 'manana', l: 'Hoy o mañana' }, { v: 'semana', l: 'Esta semana' }];
const SORT = [
  { v: '', l: 'Más relevantes' }, { v: 'disponibilidad', l: 'Próxima disponibilidad' }, { v: 'precio', l: 'Menor precio' },
  { v: 'calificacion', l: 'Mejor calificados' }, { v: 'distancia', l: 'Más cercanos' },
];
const PRICES = [{ v: '', l: 'Cualquier precio' }, ...[500, 800, 1000, 1500, 2000].map((p) => ({ v: String(p * 100), l: `Hasta $${p.toLocaleString('es-MX')}` }))];

/**
 * Buscador del directorio. Es un formulario GET normal (funciona sin JavaScript); con JavaScript
 * agrega sugerencias, «Cerca de mí» y aplica los filtros al cambiarlos.
 */
export function SearchForm({ initial, resolvedName, cities }: {
  initial: Record<string, string>; resolvedName: string | null; cities: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [q, setQ] = useState(initial.q ?? resolvedName ?? '');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [geo, setGeo] = useState<{ lat: string; lng: string } | null>(initial.lat && initial.lng ? { lat: initial.lat, lng: initial.lng } : null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const more = ['aseguradora', 'precioMax', 'videoconsulta', 'cuando'].some((k) => initial[k]) || (!!initial.orden && initial.orden !== 'disponibilidad');

  useEffect(() => { setQ(initial.q ?? resolvedName ?? ''); }, [initial.q, resolvedName]);

  useEffect(() => {
    if (q.trim().length < 2) { setSuggestions([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/public/directory/suggest?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { specialties: { name: string }[]; conditions: { name: string }[] } | null) => {
          if (d) setSuggestions([...d.specialties, ...d.conditions].map((x) => x.name));
        })
        .catch(() => undefined);
    }, 200);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  /** Envía sólo los campos con valor, para URLs limpias y compartibles. */
  function submit(overrides: Record<string, string | null> = {}) {
    if (!form.current) return;
    const p = new URLSearchParams();
    for (const [k, v] of new FormData(form.current).entries()) {
      if (typeof v === 'string' && v.trim()) p.set(k, v.trim());
    }
    for (const [k, v] of Object.entries(overrides)) {
      if (v) p.set(k, v); else p.delete(k);
    }
    // Un texto nuevo reemplaza la especialidad o padecimiento elegidos desde un enlace.
    if (p.get('q') !== (initial.q ?? resolvedName ?? '')) { p.delete('especialidad'); p.delete('padecimiento'); }
    if (p.get('orden') === 'distancia' && !p.get('lat')) p.delete('orden');
    const qs = p.toString();
    router.push(`/directorio${qs ? `?${qs}` : ''}`);
  }

  function nearMe() {
    if (!('geolocation' in navigator)) { setGeoError('Tu navegador no permite compartir la ubicación.'); return; }
    setLocating(true); setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const g = { lat: pos.coords.latitude.toFixed(4), lng: pos.coords.longitude.toFixed(4) };
        setGeo(g);
        submit({ ...g, ciudad: null, orden: 'distancia' });
      },
      () => { setLocating(false); setGeoError('No pudimos obtener tu ubicación. Elige tu ciudad.'); },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  return (
    <form ref={form} action="/directorio" method="get" role="search" className="card stack"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      onChange={(e) => {
        const name = (e.target as { name?: string }).name;
        if (name !== 'q' && name !== 'aseguradora') submit();
      }}>
      {initial.especialidad && <input type="hidden" name="especialidad" value={initial.especialidad} />}
      {initial.padecimiento && <input type="hidden" name="padecimiento" value={initial.padecimiento} />}
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label style={{ flex: '2 1 240px' }}>Especialidad, padecimiento o médico
          <input name="q" value={q} onChange={(e) => setQ(e.target.value)} list="directorio-sugerencias" autoComplete="off"
            placeholder="Ej. pediatra, dolor de espalda, Dra. López" maxLength={120} enterKeyHint="search" />
          <datalist id="directorio-sugerencias">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        {!geo && (
          <label style={{ flex: '1 1 160px' }}>Ciudad
            <select name="ciudad" defaultValue={initial.ciudad ?? ''}>
              <option value="">Todas</option>
              {cities.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </label>
        )}
        <button type="submit" className="primary">Buscar</button>
      </div>
      {initial.colonia && <input type="hidden" name="colonia" value={initial.colonia} />}
      {geo ? (
        <div className="row small">
          <input type="hidden" name="lat" value={geo.lat} /><input type="hidden" name="lng" value={geo.lng} />
          <span>Cerca de tu ubicación, a</span>
          <select name="radioKm" defaultValue={initial.radioKm ?? '10'} aria-label="Distancia máxima" style={{ width: 'auto' }}>
            {['2', '5', '10', '20', '50'].map((k) => <option key={k} value={k}>{k} km</option>)}
          </select>
          <button type="button" className="ghost small" onClick={() => { setGeo(null); submit({ lat: null, lng: null, radioKm: null, orden: initial.orden === 'distancia' ? null : initial.orden ?? null }); }}>Quitar ubicación</button>
        </div>
      ) : (
        <div className="row small">
          <button type="button" className="ghost small" onClick={nearMe} disabled={locating}>{locating ? 'Ubicando…' : '📍 Cerca de mí'}</button>
          {geoError && <span role="alert" style={{ color: 'var(--danger)' }}>{geoError}</span>}
        </div>
      )}
      <details open={more}>
        <summary className="small">Más filtros</summary>
        <div className="grid" style={{ marginTop: 8 }}>
          <label>Disponibilidad<select name="cuando" defaultValue={initial.cuando ?? ''}>{WHEN.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select></label>
          <label>Precio<select name="precioMax" defaultValue={initial.precioMax ?? ''}>{PRICES.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select></label>
          <label>Aseguradora<input name="aseguradora" defaultValue={initial.aseguradora ?? ''} maxLength={80} placeholder="Ej. GNP" /></label>
          <label>Ordenar por<select name="orden" defaultValue={initial.orden ?? ''}>
            {SORT.filter((o) => o.v !== 'distancia' || geo).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select></label>
        </div>
        <label className="check" style={{ marginTop: 8 }}><input type="checkbox" name="videoconsulta" value="true" defaultChecked={initial.videoconsulta === 'true'} />Ofrece videoconsulta</label>
      </details>
    </form>
  );
}
