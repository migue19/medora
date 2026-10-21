'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { PatientAuthForm } from '@/components/PatientAuthForm';
import { SlotPicker } from '@/components/SlotPicker';
import { VerifyEmailNotice } from '@/components/VerifyEmailNotice';
import { ApiError, errorMessage, patientSession } from '@/lib/api';
import { useSession } from '@/lib/hooks';
import { STATUS_LABEL, fmtDate, fmtTime, money, todayIn } from '@/lib/format';

interface Appt {
  id: string; startsAt: string; endsAt: string; status: string; serviceName: string; durationMinutes: number;
  priceCents: number; patientNotes: string | null; cancelReason: string | null; canChangeOnline: boolean;
  clinic: { name: string; slug: string; timezone: string; phone: string | null; address: string | null; patientCancelMinMinutes: number };
  doctor: { id: string; displayName: string; specialty: string };
  location?: { name: string; address: string | null; phone: string | null; mapUrl: string | null };
}

export function PatientPortal() {
  const { data: session, ready } = useSession(patientSession);
  const [list, setList] = useState<{ upcoming: Appt[]; past: Appt[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<Appt | null>(null);

  const reload = useCallback(async () => {
    try {
      setList(await patientSession.get('/api/patient/appointments'));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => { if (session) void reload(); else setList(null); }, [session, reload]);

  async function cancel(a: Appt) {
    if (!window.confirm(`¿Cancelar tu cita con ${a.doctor.displayName}?`)) return;
    setError(null); setNotice(null);
    try {
      await patientSession.post(`/api/patient/appointments/${a.id}/cancel`, {});
      setNotice('Cita cancelada.');
      await reload();
    } catch (e) { setError(errorMessage(e)); }
  }

  async function logout() {
    await fetch('/api/patient/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    patientSession.clear();
  }

  return (
    <>
      <Header>{session && <><span className="small muted">{session.patient.name}</span><button className="ghost" onClick={logout}>Salir</button></>}</Header>
      <main className="container section stack">
        {!ready ? <p className="muted">Cargando…</p> : !session ? (
          <div className="card narrow stack" style={{ margin: '0 auto', width: '100%' }}>
            <h1>Mis citas</h1>
            <p className="muted">Entra con tu cuenta de paciente para ver, cancelar o reprogramar tus citas.</p>
            <PatientAuthForm />
          </div>
        ) : (
          <>
            <h1>Mis citas</h1>
            {!session.patient.emailVerified && <VerifyEmailNotice email={session.patient.email} />}
            {notice && <div className="alert ok" role="status">{notice}</div>}
            {error && <div className="alert error" role="alert">{error}</div>}
            {!list ? <p className="muted">Cargando…</p> : (
              <>
                <section className="stack">
                  <h2>Próximas</h2>
                  {list.upcoming.length === 0 && <p className="muted">No tienes citas próximas. Para agendar, abre el enlace de reservas de tu clínica.</p>}
                  {list.upcoming.map((a) => (
                    <div key={a.id} className="card stack">
                      <ApptSummary a={a} />
                      {a.canChangeOnline ? (
                        <div className="row">
                          <button onClick={() => { setRescheduling(a); setNotice(null); setError(null); }}>Reprogramar</button>
                          <button className="danger" onClick={() => cancel(a)}>Cancelar</button>
                        </div>
                      ) : (
                        <p className="small muted">Para cambios, comunícate con la clínica{a.clinic.phone ? ` al ${a.clinic.phone}` : ''}.</p>
                      )}
                      {rescheduling?.id === a.id && (
                        <Reschedule a={a} onDone={async (msg) => { setRescheduling(null); if (msg) setNotice(msg); await reload(); }} />
                      )}
                    </div>
                  ))}
                </section>
                <MyWaitlist />
                <WhatsAppPreference session={session.patient} />
                {list.past.length > 0 && (
                  <section className="stack">
                    <h2>Historial</h2>
                    {list.past.map((a) => <div key={a.id} className="card"><ApptSummary a={a} /></div>)}
                  </section>
                )}
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}

function ApptSummary({ a }: { a: Appt }) {
  const tz = a.clinic.timezone;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row"><span className={`badge ${a.status}`}>{STATUS_LABEL[a.status]}</span>
        <Link href={`/c/${a.clinic.slug}`} className="small">{a.clinic.name}</Link></div>
      <strong>{fmtDate(a.startsAt, tz)} · {fmtTime(a.startsAt, tz)} h</strong>
      <span>{a.doctor.displayName} · {a.doctor.specialty}</span>
      <span className="muted small">{a.serviceName} · {a.durationMinutes} min · {money(a.priceCents)}</span>
      {a.location
        ? <span className="muted small">{[a.location.name, a.location.address ?? a.clinic.address].filter(Boolean).join(' · ')}{a.location.mapUrl && <> · <a href={a.location.mapUrl} target="_blank" rel="noreferrer">Mapa</a></>}</span>
        : a.clinic.address && <span className="muted small">{a.clinic.address}</span>}
      {a.cancelReason && <span className="muted small">Motivo de cancelación: {a.cancelReason}</span>}
    </div>
  );
}

function Reschedule({ a, onDone }: { a: Appt; onDone: (msg?: string) => void }) {
  const tz = a.clinic.timezone;
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback((from: string) => patientSession.get(`/api/patient/appointments/${a.id}/availability/${from}`), [a.id]);

  async function save() {
    if (!slot) return;
    setBusy(true); setError(null);
    try {
      await patientSession.post(`/api/patient/appointments/${a.id}/reschedule`, { startsAt: slot, expectedStartsAt: a.startsAt });
      onDone('Cita reprogramada.');
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 409) { setSlot(null); setReloadKey((k) => k + 1); }
    } finally { setBusy(false); }
  }

  return (
    <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <h3>Nuevo horario</h3>
      <SlotPicker startDate={todayIn(tz)} load={load} reloadKey={reloadKey} selected={slot} onSelect={(s) => setSlot(s)} />
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="row">
        <button className="primary" disabled={!slot || busy || slot === new Date(a.startsAt).toISOString()} onClick={save}>
          {busy ? 'Guardando…' : slot ? `Cambiar a ${fmtTime(slot, tz)} h` : 'Elige un horario'}
        </button>
        <button onClick={() => onDone()}>Cerrar</button>
      </div>
    </div>
  );
}

/** El paciente decide si recibe recordatorios por WhatsApp (consentimiento expreso). */
function WhatsAppPreference({ session }: { session: { name: string; phone: string; whatsappConsent: boolean } }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle(value: boolean) {
    setBusy(true); setError(null);
    try {
      await patientSession.patch('/api/patient/me', { name: session.name, phone: session.phone, whatsappConsent: value });
      await patientSession.refresh();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <section className="card stack">
      <h2>Recordatorios</h2>
      <p className="small muted">Te enviamos un recordatorio por correo antes de cada cita, con un enlace para confirmar o cancelar.</p>
      <label className="check">
        <input type="checkbox" checked={session.whatsappConsent} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
        También por WhatsApp al {session.phone}
      </label>
      <p className="small muted">Sólo si la clínica tiene activado WhatsApp. Puedes desactivarlo cuando quieras.</p>
      {error && <div className="alert error" role="alert">{error}</div>}
    </section>
  );
}

interface WaitEntry {
  id: string; fromDate: string | null; toDate: string | null;
  clinic?: { name: string; slug: string }; doctor?: { displayName: string }; service?: { name: string };
}

function MyWaitlist() {
  const [list, setList] = useState<WaitEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => patientSession.get<WaitEntry[]>('/api/patient/waitlist').then(setList).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { void load(); }, [load]);
  if (list.length === 0 && !error) return null;
  async function leave(e: WaitEntry) {
    if (!window.confirm('¿Salir de esta lista de espera?')) return;
    try { await patientSession.post(`/api/patient/waitlist/${e.id}/leave`); await load(); } catch (err) { setError(errorMessage(err)); }
  }
  return (
    <section className="card stack">
      <h2>Listas de espera</h2>
      <p className="small muted">Si se libera un horario, te lo apartamos y te avisamos por correo.</p>
      {error && <div className="alert error" role="alert">{error}</div>}
      {list.map((e) => (
        <div key={e.id} className="row small">
          <span><strong>{e.clinic?.name}</strong> · {e.doctor?.displayName} · {e.service?.name}{e.fromDate || e.toDate ? ` · del ${e.fromDate ?? '…'} al ${e.toDate ?? '…'}` : ''}</span>
          <button className="danger" onClick={() => leave(e)}>Salir</button>
        </div>
      ))}
    </section>
  );
}
