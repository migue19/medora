'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { SlotPicker } from '@/components/SlotPicker';
import { PatientAuthForm } from '@/components/PatientAuthForm';
import { VerifyEmailNotice } from '@/components/VerifyEmailNotice';
import { ApiError, errorMessage, patientSession, publicGet } from '@/lib/api';
import { useSession } from '@/lib/hooks';
import { RatingSummaryLine, Stars } from '@/components/Stars';
import { fmtDate, fmtTime, money, todayIn, uuid, weeklyLabel } from '@/lib/format';

interface Service {
  id: string; name: string; durationMinutes: number; priceCents: number; visitType: 'ANY' | 'FIRST' | 'FOLLOW_UP';
  priceByLocation: Record<string, number>;
}
interface Doctor {
  id: string; displayName: string; slug: string; specialty: string; licenseNumber: string | null; bio: string | null;
  services: Service[]; photoUrl: string | null; locationIds: string[];
  education: string[]; certifications: string[]; languages: string[]; conditions: string[]; insurers: string[];
  rating: { count: number; average: number; punctuality: number; treatment: number; facilities: number } | null;
  reviews: Review[];
}
interface Review {
  id: string; authorName: string; rating: number; comment: string | null; createdAt: string;
  reply: { text: string; by: string } | null;
}
interface Place {
  id: string; name: string; address: string | null; phone: string | null; mapUrl: string | null;
  hours: { weekday: number; startMinute: number; endMinute: number }[];
}
interface Profile {
  clinic: { name: string; slug: string; phone: string | null; address: string | null; timezone: string; bookingEnabled: boolean; patientCancelMinMinutes: number };
  locations: Place[];
  doctors: Doctor[];
}

const VISIT: Record<string, string> = { FIRST: 'Primera vez', FOLLOW_UP: 'Subsecuente' };

/** Precio a mostrar: el de la sede elegida, o «desde» el menor si varía entre sedes. */
function priceLabel(s: Service, locationId: string | null): string {
  if (locationId && s.priceByLocation[locationId] !== undefined) return money(s.priceByLocation[locationId]);
  const values = [...new Set(Object.values(s.priceByLocation))];
  if (values.length > 1) return `desde ${money(Math.min(...values))}`;
  return money(values[0] ?? s.priceCents);
}

const initials = (name: string) => name.replace(/^(Dr|Dra)\.?\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

interface Props {
  slug: string;
  /** Perfil ya cargado en el servidor: la página llega completa en el HTML (indexable y sin parpadeo). */
  initialProfile?: Profile | null;
  /** Página de un médico: muestra sólo a ese médico. */
  doctorSlug?: string;
  /** Dentro del widget en el sitio de la clínica (iframe). */
  embedded?: boolean;
}

const CHANNELS = ['google', 'instagram', 'widget', 'directorio'] as const;

export function BookingPage({ slug, initialProfile, doctorSlug, embedded = false }: Props) {
  const [profile, setProfile] = useState<Profile | null>(initialProfile ?? null);
  const [channel, setChannel] = useState<string>(embedded ? 'widget' : 'web');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [slot, setSlot] = useState<{ startsAt: string; time: string } | null>(null);
  const [notes, setNotes] = useState('');
  const [requestId, setRequestId] = useState(uuid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<{ startsAt: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { data: patient } = useSession(patientSession);

  useEffect(() => {
    if (initialProfile) return;
    publicGet<Profile>(`/api/public/clinics/${encodeURIComponent(slug)}`)
      .then(setProfile)
      .catch((e) => setLoadError(e instanceof ApiError && e.status === 404 ? 'No encontramos esta clínica.' : errorMessage(e)));
  }, [slug, initialProfile]);

  // Origen de la visita (?origen=google|instagram) para saber de dónde llegan las reservas.
  useEffect(() => {
    if (embedded) return;
    const origin = new URLSearchParams(window.location.search).get('origen');
    if (origin && (CHANNELS as readonly string[]).includes(origin)) setChannel(origin);
  }, [embedded]);

  // Desde el directorio: llega con el servicio (?servicio=) y, si eligió uno, el horario (?hora=&sede=) ya marcados.
  const preselected = useRef(false);
  useEffect(() => {
    if (!profile || preselected.current || !doctorSlug) return;
    preselected.current = true;
    const q = new URLSearchParams(window.location.search);
    const d = profile.doctors.find((x) => x.slug === doctorSlug);
    const s = d?.services.find((x) => x.id === q.get('servicio'));
    if (!d || !s || !profile.clinic.bookingEnabled) return;
    chooseDoctor(d, s);
    const sede = q.get('sede');
    if (sede && d.locationIds.includes(sede)) setLocationId(sede);
    const hora = q.get('hora');
    const withTime = !!hora && !Number.isNaN(Date.parse(hora)) && Date.parse(hora) > Date.now();
    if (withTime) {
      setSlot({ startsAt: new Date(hora!).toISOString(), time: fmtTime(hora!, profile.clinic.timezone) });
    }
    // Tras cargar los horarios (que cambian la altura de la página), lleva al paso siguiente.
    const target = withTime ? 'confirmar' : 'horarios';
    setTimeout(() => document.getElementById(target)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 600);
  }, [profile, doctorSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  const tz = profile?.clinic.timezone ?? 'America/Mexico_City';
  const today = useMemo(() => todayIn(tz), [tz]);

  const load = useCallback(
    (from: string) => publicGet(`/api/public/clinics/${encodeURIComponent(slug)}/doctors/${doctor!.id}/availability?serviceId=${service!.id}&from=${from}&days=7${locationId ? `&locationId=${locationId}` : ''}`),
    [slug, doctor, service, locationId],
  );

  function chooseDoctor(d: Doctor, s: Service) {
    setDoctor(d); setService(s); setSlot(null); setError(null); setBooked(null); setRequestId(uuid());
    // Si atiende en una sola sede, queda elegida; si atiende en varias, el paciente la elige.
    setLocationId(d.locationIds.length === 1 ? d.locationIds[0] : null);
  }

  const place = (id: string | null) => profile?.locations.find((l) => l.id === id) ?? null;

  async function confirm() {
    if (!doctor || !service || !slot) return;
    setBusy(true);
    setError(null);
    try {
      const res = await patientSession.post(`/api/public/clinics/${encodeURIComponent(slug)}/appointments`, {
        requestId, doctorId: doctor.id, serviceId: service.id, startsAt: slot.startsAt, notes: notes.trim() || null, channel,
      });
      setBooked({ startsAt: res.appointment.startsAt });
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 409) {
        setSlot(null); setRequestId(uuid()); setReloadKey((k) => k + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (<><Header /><main className="container narrow section"><div className="alert error">{loadError}</div></main></>);
  }
  if (!profile) return (<><Header /><main className="container section"><p className="muted">Cargando…</p></main></>);

  const { clinic } = profile;

  const base = embedded ? '/embed' : '/c';
  const focus = doctorSlug ? profile.doctors.find((d) => d.slug === doctorSlug) ?? null : null;
  const doctors = focus ? [focus] : profile.doctors;
  const external = embedded ? { target: '_blank', rel: 'noopener' } : {};

  return (
    <>
      {embedded ? (
        <header className="topbar"><div className="container">
          <strong>{clinic.name}</strong><span className="spacer" />
          <a className="btn ghost small" href="/paciente" {...external}>Mis citas</a>
        </div></header>
      ) : <Header><Link className="btn ghost" href="/paciente">Mis citas</Link></Header>}
      <main className="container section stack">
        <div>
          {focus ? (
            <>
              <p className="small"><Link href={`${base}/${clinic.slug}`}>← Todos los médicos de {clinic.name}</Link></p>
              <h1>{focus.displayName}</h1>
              <p className="muted">{focus.specialty} · {clinic.name}</p>
            </>
          ) : <h1>{clinic.name}</h1>}
          {!focus && <p className="muted">{profile.locations.length > 1 ? `${profile.locations.length} sedes` : [profile.locations[0]?.address ?? clinic.address, clinic.phone].filter(Boolean).join(' · ') || 'Reserva tu cita en línea'}</p>}
        </div>
        {profile.locations.length > 1 && !focus && (
          <div className="grid">
            {profile.locations.map((l) => (
              <div key={l.id} className="card stack" style={{ gap: 4 }}>
                <strong>{l.name}</strong>
                {l.address && <span className="small">{l.address}</span>}
                <span className="small muted">{[l.phone, l.hours.length ? weeklyLabel(l.hours) : null].filter(Boolean).join(' · ')}</span>
                {l.mapUrl && <a className="small" href={l.mapUrl} target="_blank" rel="noreferrer">Ver en el mapa</a>}
              </div>
            ))}
          </div>
        )}

        {!clinic.bookingEnabled && <div className="alert warn">Por ahora esta clínica no recibe reservas en línea{clinic.phone ? `. Llama al ${clinic.phone}` : ''}.</div>}

        {booked ? (
          <div className="card stack" role="status">
            <div className="alert ok">¡Tu cita quedó agendada!</div>
            <h2>{doctor?.displayName}</h2>
            <p>{service?.name} · {priceLabel(service!, locationId)}</p>
            {place(locationId) && <p className="small">{place(locationId)!.name}{place(locationId)!.address ? ` · ${place(locationId)!.address}` : ''}</p>}
            <p><strong>{fmtDate(booked.startsAt, tz)}</strong> a las <strong>{fmtTime(booked.startsAt, tz)}</strong> (hora de la clínica)</p>
            <p className="muted small">Te enviamos la confirmación por correo con un archivo para agregarla a tu calendario.</p>
            <div className="row">
              <a className="btn primary" href="/paciente" {...external}>Ver mis citas</a>
              <button onClick={() => { setBooked(null); setSlot(null); setRequestId(uuid()); setReloadKey((k) => k + 1); }}>Agendar otra</button>
            </div>
          </div>
        ) : (
          <>
            <section className="stack">
              <h2>1. Elige médico y servicio</h2>
              {doctors.length === 0 && <p className="muted">Aún no hay médicos con agenda en línea.</p>}
              <div className="grid">
                {doctors.map((d) => (
                  <div key={d.id} className="card stack">
                    <div className="doctor">
                      {d.photoUrl
                        ? <img className="avatar" src={d.photoUrl} alt={`Foto de ${d.displayName}`} width={48} height={48} style={{ objectFit: 'cover' }} />
                        : <div className="avatar" aria-hidden>{initials(d.displayName)}</div>}
                      <div>
                        <h3 style={{ margin: 0 }}>{focus ? d.displayName : <Link href={`${base}/${clinic.slug}/${d.slug}`}>{d.displayName}</Link>}</h3>
                        <div className="muted small">{d.specialty}{d.licenseNumber ? ` · Céd. ${d.licenseNumber}` : ''}</div>
                        {profile.locations.length > 1 && <div className="muted small">{d.locationIds.map((id) => place(id)?.name).filter(Boolean).join(' · ')}</div>}
                        <RatingSummaryLine rating={d.rating} />
                      </div>
                    </div>
                    {d.bio && <p className="small">{d.bio}</p>}
                    <DoctorDetails d={d} />
                    <div className="stack" style={{ gap: 6 }}>
                      {d.services.map((s) => (
                        <button key={s.id} type="button" aria-pressed={doctor?.id === d.id && service?.id === s.id}
                          className={doctor?.id === d.id && service?.id === s.id ? 'primary' : ''}
                          onClick={() => chooseDoctor(d, s)} disabled={!clinic.bookingEnabled}
                          style={{ justifyContent: 'space-between' }}>
                          <span>{s.name} · {s.durationMinutes} min{VISIT[s.visitType] ? ` · ${VISIT[s.visitType]}` : ''}</span><span>{priceLabel(s, null)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {focus && focus.rating && focus.rating.count > 0 && <DoctorReviews slug={clinic.slug} doctor={focus} tz={tz} />}

            {doctor && service && (
              <section className="card stack" id="horarios">
                <h2>2. Elige fecha y hora</h2>
                {doctor.locationIds.length > 1 && (
                  <div className="stack" style={{ gap: 6 }}>
                    <span className="small" style={{ fontWeight: 600 }}>Sede</span>
                    <div className="row">
                      {doctor.locationIds.map((id) => (
                        <button key={id} type="button" aria-pressed={locationId === id} className={locationId === id ? 'primary' : ''}
                          onClick={() => { setLocationId(id); setSlot(null); setRequestId(uuid()); }}>
                          {place(id)?.name} · {priceLabel(service, id)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <p className="muted small">Horarios en la zona horaria de la clínica ({tz}).</p>
                {locationId || doctor.locationIds.length <= 1 ? (
                  <SlotPicker startDate={today} load={load} reloadKey={reloadKey} selected={slot?.startsAt ?? null}
                    onSelect={(startsAt, time) => { setSlot({ startsAt, time }); setError(null); setRequestId(uuid()); }} />
                ) : <p className="muted">Elige la sede para ver los horarios.</p>}
                <JoinWaitlist slug={slug} doctorId={doctor.id} serviceId={service.id} doctorName={doctor.displayName}
                  patient={patient?.patient ?? null} />
              </section>
            )}

            {slot && doctor && service && (
              <section className="card stack" id="confirmar">
                <h2>3. Confirma tu cita</h2>
                <p><strong>{doctor.displayName}</strong> · {service.name} · {priceLabel(service, locationId)}</p>
                {place(locationId) && (
                  <p className="small">{place(locationId)!.name}{place(locationId)!.address ? ` · ${place(locationId)!.address}` : ''}
                    {place(locationId)!.mapUrl && <> · <a href={place(locationId)!.mapUrl!} target="_blank" rel="noreferrer">Mapa</a></>}</p>
                )}
                <p>{fmtDate(slot.startsAt, tz)} · {slot.time} h</p>
                {!patient ? (
                  <div className="stack">
                    <p className="muted">Inicia sesión o crea tu cuenta para confirmar.</p>
                    <div className="narrow"><PatientAuthForm /></div>
                  </div>
                ) : (
                  <>
                    <p className="small muted">Reservando como {patient.patient.name} ({patient.patient.email})</p>
                    {!patient.patient.emailVerified && <VerifyEmailNotice email={patient.patient.email} />}
                    <label>Motivo de consulta (opcional)
                      <textarea value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. revisión anual" />
                    </label>
                    <p className="muted small">
                      Podrás cancelar o reprogramar en línea hasta {Math.round(clinic.patientCancelMinMinutes / 60 * 10) / 10} h antes de la cita.
                    </p>
                    {error && <div className="alert error" role="alert">{error}</div>}
                    <button className="primary" onClick={confirm} disabled={busy || !patient.patient.emailVerified}>{busy ? 'Agendando…' : 'Confirmar cita'}</button>
                  </>
                )}
              </section>
            )}
            {error && !slot && <div className="alert error" role="alert">{error}</div>}
          </>
        )}
      </main>
    </>
  );
}

/** Si ningún horario le sirve, el paciente se anota y se le avisa cuando se libere uno. */
function JoinWaitlist({ slug, doctorId, serviceId, doctorName, patient }: {
  slug: string; doctorId: string; serviceId: string; doctorName: string;
  patient: { emailVerified: boolean } | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  async function join() {
    setBusy(true); setMsg(null);
    try {
      await patientSession.post(`/api/public/clinics/${encodeURIComponent(slug)}/waitlist`, {
        doctorId, serviceId, fromDate: fromDate || null, toDate: toDate || null,
      });
      setMsg({ ok: true, text: `Te anotamos en la lista de espera de ${doctorName}. Si se libera un horario te lo apartamos y te avisamos por correo.` });
      setOpen(false);
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      {!open ? (
        <p className="small muted">¿Ningún horario te sirve? <button className="ghost small" onClick={() => setOpen(true)}>Anótate en la lista de espera</button></p>
      ) : !patient ? (
        <p className="small">Inicia sesión o crea tu cuenta (más abajo, al elegir un horario, o en <a href="/paciente">Mis citas</a>) para anotarte.</p>
      ) : !patient.emailVerified ? (
        <p className="small">Confirma tu correo para anotarte en la lista de espera.</p>
      ) : (
        <div className="stack card">
          <span className="small">Te avisaremos si se libera un horario con {doctorName}. Opcional: ¿entre qué fechas te sirve?</span>
          <div className="row">
            <label>Desde<input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
            <label>Hasta<input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
          </div>
          <div className="row">
            <button className="primary" disabled={busy} onClick={join}>{busy ? 'Anotando…' : 'Anotarme'}</button>
            <button onClick={() => setOpen(false)}>Cancelar</button>
          </div>
        </div>
      )}
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="status">{msg.text}</div>}
    </div>
  );
}

/** Perfil profesional plegable: formación, certificaciones, idiomas, padecimientos y aseguradoras. */
function DoctorDetails({ d }: { d: Doctor }) {
  const sections = [
    ['Formación', d.education], ['Certificaciones', d.certifications], ['Idiomas', d.languages],
    ['Padecimientos que atiende', d.conditions], ['Aseguradoras', d.insurers],
  ] as const;
  if (sections.every(([, list]) => !list.length)) return null;
  return (
    <details>
      <summary className="small">Ver perfil profesional</summary>
      <div className="stack" style={{ gap: 6, marginTop: 6 }}>
        {sections.filter(([, list]) => list.length).map(([title, list]) => (
          <div key={title} className="small"><strong>{title}:</strong> {list.join(' · ')}</div>
        ))}
      </div>
    </details>
  );
}

/** Opiniones verificadas del médico: las primeras llegan en el HTML; el resto se cargan por páginas. */
function DoctorReviews({ slug, doctor, tz }: { slug: string; doctor: Doctor; tz: string }) {
  const [reviews, setReviews] = useState<Review[]>(doctor.reviews);
  // Página siguiente de la API (10 por página); la 1 reemplaza las 5 que vinieron en el HTML.
  const [nextPage, setNextPage] = useState(1);
  const [more, setMore] = useState(doctor.rating!.count > doctor.reviews.length);
  const r = doctor.rating!;
  async function loadMore() {
    const res = await publicGet<{ reviews: Review[]; hasMore: boolean }>(`/api/public/reviews/clinics/${slug}/doctors/${doctor.slug}?page=${nextPage}`);
    setReviews(nextPage === 1 ? res.reviews : [...reviews, ...res.reviews]);
    setNextPage(nextPage + 1);
    setMore(res.hasMore);
  }
  return (
    <section className="card stack" aria-labelledby="opiniones">
      <h2 id="opiniones">Opiniones verificadas</h2>
      <div className="row"><Stars value={r.average} size={20} /> <strong>{r.average.toFixed(1)}</strong>
        <span className="muted small">de {r.count} {r.count === 1 ? 'paciente atendido' : 'pacientes atendidos'}</span></div>
      <p className="small muted">Puntualidad {r.punctuality.toFixed(1)} · Trato {r.treatment.toFixed(1)} · Instalaciones {r.facilities.toFixed(1)}. Sólo opinan pacientes con una cita atendida.</p>
      {reviews.map((x) => (
        <article key={x.id} className="stack" style={{ gap: 4, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div className="row"><Stars value={x.rating} /> <strong className="small">{x.authorName}</strong>
            <span className="small muted">{fmtDate(x.createdAt, tz)}</span></div>
          {x.comment && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{x.comment}</p>}
          {x.reply && <p className="small" style={{ margin: 0, paddingLeft: 12, borderLeft: '3px solid var(--primary)' }}><strong>Respuesta de {x.reply.by}:</strong> {x.reply.text}</p>}
        </article>
      ))}
      {more && <div><button onClick={() => void loadMore()}>Ver más opiniones</button></div>}
    </section>
  );
}
