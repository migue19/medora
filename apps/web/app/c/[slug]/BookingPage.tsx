'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from '@/components/Header';
import { SlotPicker } from '@/components/SlotPicker';
import { PatientAuthForm } from '@/components/PatientAuthForm';
import { VerifyEmailNotice } from '@/components/VerifyEmailNotice';
import { ApiError, errorMessage, patientSession, publicGet } from '@/lib/api';
import { useSession } from '@/lib/hooks';
import { fmtDate, fmtTime, money, todayIn, uuid } from '@/lib/format';

interface Service { id: string; name: string; durationMinutes: number; priceCents: number }
interface Doctor { id: string; displayName: string; specialty: string; licenseNumber: string | null; bio: string | null; services: Service[] }
interface Profile {
  clinic: { name: string; slug: string; phone: string | null; address: string | null; timezone: string; bookingEnabled: boolean; patientCancelMinMinutes: number };
  doctors: Doctor[];
}

const initials = (name: string) => name.replace(/^(Dr|Dra)\.?\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function BookingPage({ slug }: { slug: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [slot, setSlot] = useState<{ startsAt: string; time: string } | null>(null);
  const [notes, setNotes] = useState('');
  const [requestId, setRequestId] = useState(uuid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<{ startsAt: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { data: patient } = useSession(patientSession);

  useEffect(() => {
    publicGet<Profile>(`/api/public/clinics/${encodeURIComponent(slug)}`)
      .then(setProfile)
      .catch((e) => setLoadError(e instanceof ApiError && e.status === 404 ? 'No encontramos esta clínica.' : errorMessage(e)));
  }, [slug]);

  const tz = profile?.clinic.timezone ?? 'America/Mexico_City';
  const today = useMemo(() => todayIn(tz), [tz]);

  const load = useCallback(
    (from: string) => publicGet(`/api/public/clinics/${encodeURIComponent(slug)}/doctors/${doctor!.id}/availability?serviceId=${service!.id}&from=${from}&days=7`),
    [slug, doctor, service],
  );

  function chooseDoctor(d: Doctor, s: Service) {
    setDoctor(d); setService(s); setSlot(null); setError(null); setBooked(null); setRequestId(uuid());
  }

  async function confirm() {
    if (!doctor || !service || !slot) return;
    setBusy(true);
    setError(null);
    try {
      const res = await patientSession.post(`/api/public/clinics/${encodeURIComponent(slug)}/appointments`, {
        requestId, doctorId: doctor.id, serviceId: service.id, startsAt: slot.startsAt, notes: notes.trim() || null,
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

  return (
    <>
      <Header><Link className="btn ghost" href="/paciente">Mis citas</Link></Header>
      <main className="container section stack">
        <div>
          <h1>{clinic.name}</h1>
          <p className="muted">{[clinic.address, clinic.phone].filter(Boolean).join(' · ') || 'Reserva tu cita en línea'}</p>
        </div>

        {!clinic.bookingEnabled && <div className="alert warn">Por ahora esta clínica no recibe reservas en línea{clinic.phone ? `. Llama al ${clinic.phone}` : ''}.</div>}

        {booked ? (
          <div className="card stack" role="status">
            <div className="alert ok">¡Tu cita quedó agendada!</div>
            <h2>{doctor?.displayName}</h2>
            <p>{service?.name} · {money(service!.priceCents)}</p>
            <p><strong>{fmtDate(booked.startsAt, tz)}</strong> a las <strong>{fmtTime(booked.startsAt, tz)}</strong> (hora de la clínica)</p>
            <p className="muted small">Te enviamos la confirmación por correo con un archivo para agregarla a tu calendario.</p>
            <div className="row">
              <Link className="btn primary" href="/paciente">Ver mis citas</Link>
              <button onClick={() => { setBooked(null); setSlot(null); setRequestId(uuid()); setReloadKey((k) => k + 1); }}>Agendar otra</button>
            </div>
          </div>
        ) : (
          <>
            <section className="stack">
              <h2>1. Elige médico y servicio</h2>
              {profile.doctors.length === 0 && <p className="muted">Aún no hay médicos con agenda en línea.</p>}
              <div className="grid">
                {profile.doctors.map((d) => (
                  <div key={d.id} className="card stack">
                    <div className="doctor">
                      <div className="avatar" aria-hidden>{initials(d.displayName)}</div>
                      <div>
                        <h3 style={{ margin: 0 }}>{d.displayName}</h3>
                        <div className="muted small">{d.specialty}{d.licenseNumber ? ` · Céd. ${d.licenseNumber}` : ''}</div>
                      </div>
                    </div>
                    {d.bio && <p className="small">{d.bio}</p>}
                    <div className="stack" style={{ gap: 6 }}>
                      {d.services.map((s) => (
                        <button key={s.id} type="button" aria-pressed={doctor?.id === d.id && service?.id === s.id}
                          className={doctor?.id === d.id && service?.id === s.id ? 'primary' : ''}
                          onClick={() => chooseDoctor(d, s)} disabled={!clinic.bookingEnabled}
                          style={{ justifyContent: 'space-between' }}>
                          <span>{s.name} · {s.durationMinutes} min</span><span>{money(s.priceCents)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {doctor && service && (
              <section className="card stack">
                <h2>2. Elige fecha y hora</h2>
                <p className="muted small">Horarios en la zona horaria de la clínica ({tz}).</p>
                <SlotPicker startDate={today} load={load} reloadKey={reloadKey} selected={slot?.startsAt ?? null}
                  onSelect={(startsAt, time) => { setSlot({ startsAt, time }); setError(null); setRequestId(uuid()); }} />
              </section>
            )}

            {slot && doctor && service && (
              <section className="card stack">
                <h2>3. Confirma tu cita</h2>
                <p><strong>{doctor.displayName}</strong> · {service.name} · {money(service.priceCents)}</p>
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
