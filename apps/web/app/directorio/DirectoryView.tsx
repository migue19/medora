import Link from 'next/link';
import { Header } from '@/components/Header';
import { RatingSummaryLine } from '@/components/Stars';
import { addDays, cap, fmtDay, money, todayIn } from '@/lib/format';
import type { DirectoryOverview, DirectoryResult, DirectorySearch } from '@/lib/server-api';
import { SearchForm } from './SearchForm';

/** Parámetros de búsqueda que entiende la API (el resto se ignora). */
export const SEARCH_KEYS = [
  'q', 'especialidad', 'padecimiento', 'ciudad', 'colonia', 'aseguradora', 'precioMax', 'videoconsulta', 'cuando',
  'lat', 'lng', 'radioKm', 'orden', 'pagina',
] as const;

export function toParams(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const p = new URLSearchParams();
  for (const k of SEARCH_KEYS) {
    const v = raw[k];
    const value = Array.isArray(v) ? v[0] : v;
    if (value && value.trim()) p.set(k, value.trim().slice(0, 120));
  }
  return p;
}

const initials = (name: string) => name.replace(/^(Dr|Dra)\.?\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function dayLabel(date: string, tz: string) {
  const today = todayIn(tz);
  if (date === today) return 'Hoy';
  if (date === addDays(today, 1)) return 'Mañana';
  return cap(fmtDay(date));
}

/** Enlace a la página del médico con el servicio (y el horario, si se eligió) ya seleccionados. */
function bookingHref(r: DirectoryResult, slot?: { startsAt: string; locationId?: string }) {
  const p = new URLSearchParams({ origen: 'directorio', servicio: r.service.id });
  if (slot) {
    p.set('hora', slot.startsAt);
    if (slot.locationId) p.set('sede', slot.locationId);
  }
  return `/c/${r.clinic.slug}/${r.doctor.slug}?${p}`;
}

function ResultCard({ r }: { r: DirectoryResult }) {
  const zone = r.locations.map((l) => [l.neighborhood, l.city].filter(Boolean).join(', ') || l.name);
  return (
    <article className="card stack">
      <div className="doctor">
        {r.doctor.photoUrl
          ? <img className="avatar" src={r.doctor.photoUrl} alt="" width={56} height={56} style={{ width: 56, height: 56, objectFit: 'cover' }} loading="lazy" />
          : <div className="avatar" aria-hidden style={{ width: 56, height: 56 }}>{initials(r.doctor.displayName)}</div>}
        <div className="stack" style={{ gap: 2, flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}><Link href={bookingHref(r)}>{r.doctor.displayName}</Link></h2>
          <span className="small">{r.doctor.specialty}{r.doctor.licenseNumber ? <span className="muted"> · Céd. {r.doctor.licenseNumber}</span> : null}</span>
          <span className="small muted">{r.clinic.name} · {[...new Set(zone)].join(' · ')}{r.distanceKm !== null ? ` · a ${r.distanceKm} km` : ''}</span>
          <RatingSummaryLine rating={r.rating} />
        </div>
        <div className="stack" style={{ gap: 2, textAlign: 'right' }}>
          <strong>{money(r.priceFromCents)}</strong>
          <span className="small muted">{r.service.name}</span>
          {r.telemedicine && <span className="badge COMPLETED small">Videoconsulta</span>}
        </div>
      </div>
      {(r.doctor.conditions.length > 0 || r.doctor.insurers.length > 0) && (
        <p className="small muted" style={{ margin: 0 }}>
          {r.doctor.conditions.length > 0 && <>Atiende: {r.doctor.conditions.join(', ')}. </>}
          {r.doctor.insurers.length > 0 && <>Aseguradoras: {r.doctor.insurers.join(', ')}.</>}
        </p>
      )}
      {r.next ? (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small"><strong>Próxima disponibilidad: {dayLabel(r.next.date, r.clinic.timezone)}</strong></span>
          <div className="slots">
            {r.next.slots.map((s) => (
              <Link key={s.startsAt} className="btn slot" href={bookingHref(r, s)} aria-label={`Reservar ${dayLabel(r.next!.date, r.clinic.timezone)} a las ${s.time} con ${r.doctor.displayName}`}>{s.time}</Link>
            ))}
          </div>
          <Link className="small" href={bookingHref(r)}>Ver más horarios →</Link>
        </div>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>Sin horarios en las próximas dos semanas. <Link href={bookingHref(r)}>Ver agenda y lista de espera</Link></p>
      )}
    </article>
  );
}

export function DirectoryView({ title, intro, params, data, overview, basePath = '/directorio', pageParams = params }: {
  title: string; intro?: string; params: URLSearchParams; data: DirectorySearch; overview: DirectoryOverview;
  /** Páginas por especialidad y ciudad: la paginación conserva su propia URL. */
  basePath?: string; pageParams?: URLSearchParams;
}) {
  const pages = Math.ceil(data.total / data.pageSize);
  const pageHref = (n: number) => {
    const p = new URLSearchParams(pageParams);
    if (n > 1) p.set('pagina', String(n)); else p.delete('pagina');
    const qs = p.toString();
    return `${basePath}${qs ? `?${qs}` : ''}`;
  };
  return (
    <>
      <Header><Link className="btn ghost" href="/paciente">Mis citas</Link></Header>
      <main className="container section stack">
        <div>
          <h1>{title}</h1>
          {intro && <p className="muted">{intro}</p>}
        </div>
        <SearchForm
          key={params.toString()}
          initial={Object.fromEntries(params)}
          resolvedName={data.resolved.specialty?.name ?? data.resolved.condition?.name ?? null}
          cities={overview.cities}
        />
        <p className="small muted" aria-live="polite">
          {data.total === 0 ? 'No encontramos médicos con esos filtros.' : `${data.total} ${data.total === 1 ? 'médico' : 'médicos'}`}
          {data.resolved.condition ? ` que atienden ${data.resolved.condition.name.toLowerCase()}` : ''}
        </p>
        {data.total === 0 && (
          <div className="card stack">
            <p>Prueba con menos filtros o busca por especialidad:</p>
            <div className="row">
              {overview.specialties.slice(0, 12).map((s) => <Link key={s.slug} className="btn small" href={`/directorio/${s.slug}`}>{s.name}</Link>)}
            </div>
          </div>
        )}
        <div className="stack">
          {data.results.map((r) => <ResultCard key={r.doctor.id} r={r} />)}
        </div>
        {pages > 1 && (
          <nav className="row" aria-label="Páginas de resultados">
            {data.page > 1 && <Link className="btn" href={pageHref(data.page - 1)} rel="prev">← Anterior</Link>}
            <span className="small muted">Página {data.page} de {pages}</span>
            {data.page < pages && <Link className="btn" href={pageHref(data.page + 1)} rel="next">Siguiente →</Link>}
          </nav>
        )}
        {overview.specialties.length > 0 && (
          <section className="stack" aria-labelledby="especialidades">
            <h2 id="especialidades" style={{ fontSize: '1.1rem' }}>Especialidades</h2>
            <div className="row">
              {overview.specialties.map((s) => <Link key={s.slug} className="small" href={`/directorio/${s.slug}`}>{s.name} ({s.doctors})</Link>)}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
