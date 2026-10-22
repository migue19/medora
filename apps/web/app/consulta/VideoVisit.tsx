'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DailyCall } from '@daily-co/daily-js';
import { Header } from '@/components/Header';
import { PatientAuthForm } from '@/components/PatientAuthForm';
import { Session, errorMessage, patientSession, staffSession } from '@/lib/api';
import { useSession } from '@/lib/hooks';
import { fmtDate, fmtTime } from '@/lib/format';
import { takeLinkToken } from '@/lib/link-token';

interface Info {
  appointmentId: string; status: string; startsAt: string; endsAt: string; serviceName: string;
  clinic: { name: string; timezone: string; phone: string | null };
  doctor: { displayName: string; specialty: string }; patientName: string;
  opensAt: string; closesAt: string; open: boolean; consentGiven: boolean; consentText: string[]; available: boolean;
  patientWaiting?: boolean;
}

/** Cómo entró: con el enlace del correo, desde «Mis citas» o como médico desde la agenda. */
type Mode = { kind: 'link'; token: string } | { kind: 'patient'; id: string } | { kind: 'doctor'; id: string };

const anon = new Session('patient');
const STORAGE = 'medora-consulta';

function api(mode: Mode) {
  if (mode.kind === 'link') {
    return {
      info: () => anon.request<Info>('POST', '/api/video/link/info', { token: mode.token }, false),
      join: (consent: boolean) => anon.request<{ url: string; token: string }>('POST', '/api/video/link/join', { token: mode.token, consent }, false),
      heartbeat: () => anon.request('POST', '/api/video/link/heartbeat', { token: mode.token }, false),
    };
  }
  if (mode.kind === 'patient') {
    return {
      info: () => patientSession.get<Info>(`/api/patient/appointments/${mode.id}/video`),
      join: (consent: boolean) => patientSession.post<{ url: string; token: string }>(`/api/patient/appointments/${mode.id}/video/join`, { consent }),
      heartbeat: () => patientSession.post(`/api/patient/appointments/${mode.id}/video/heartbeat`, {}),
    };
  }
  return {
    info: () => staffSession.get<Info>(`/api/clinic/appointments/${mode.id}/video`),
    join: () => staffSession.post<{ url: string; token: string }>(`/api/clinic/appointments/${mode.id}/video/join`, {}),
    heartbeat: async () => undefined,
  };
}

export function VideoVisit() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const q = new URLSearchParams(window.location.search);
    const id = q.get('cita');
    if (id && /^[0-9a-f-]{36}$/.test(id)) { setMode(q.get('rol') === 'medico' ? { kind: 'doctor', id } : { kind: 'patient', id }); return; }
    // El enlace del correo trae el pase en el fragmento; se conserva en la pestaña por si recarga.
    let token = takeLinkToken();
    try {
      if (token) sessionStorage.setItem(STORAGE, token); else token = sessionStorage.getItem(STORAGE);
    } catch { /* sin almacenamiento */ }
    if (token) setMode({ kind: 'link', token });
    else setError('El enlace está incompleto. Ábrelo desde el correo de tu cita o desde «Mis citas».');
  }, []);

  if (error) return (<><Header /><main className="container narrow section"><div className="alert error" role="alert">{error}</div></main></>);
  if (!mode) return (<><Header /><main className="container section"><p className="muted">Cargando…</p></main></>);
  if (mode.kind === 'patient') return <RequireSession session={patientSession} kind="patient"><Visit mode={mode} /></RequireSession>;
  if (mode.kind === 'doctor') return <RequireSession session={staffSession} kind="staff"><Visit mode={mode} /></RequireSession>;
  return <Visit mode={mode} />;
}

function RequireSession({ session, kind, children }: { session: Session; kind: 'patient' | 'staff'; children: React.ReactNode }) {
  const { data, ready } = useSession(session);
  if (!ready) return (<><Header /><main className="container section"><p className="muted">Cargando…</p></main></>);
  if (data) return <>{children}</>;
  return (
    <>
      <Header />
      <main className="container narrow section stack">
        <h1>Videoconsulta</h1>
        {kind === 'patient'
          ? <><p className="muted">Entra con tu cuenta de paciente para abrir la sala.</p><PatientAuthForm /></>
          : <p>Inicia sesión en el <Link href="/login">panel de la clínica</Link> y vuelve a abrir la videoconsulta desde la agenda.</p>}
      </main>
    </>
  );
}

function Visit({ mode }: { mode: Mode }) {
  const calls = useRef(api(mode));
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<'lobby' | 'joining' | 'call' | 'left'>('lobby');
  const frameRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);
  const doctor = mode.kind === 'doctor';

  const load = useCallback(() => calls.current.info().then(setInfo).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { void load(); }, [load]);
  // Mientras espera a que abra la sala (o, el médico, a que llegue el paciente), se actualiza sola.
  useEffect(() => {
    if (phase !== 'lobby') return;
    const t = setInterval(() => { void load(); }, doctor ? 10_000 : 30_000);
    return () => clearInterval(t);
  }, [phase, load, doctor]);
  // El paciente en la sala avisa que sigue ahí: el médico lo ve «en sala de espera».
  useEffect(() => {
    if (doctor || phase !== 'call') return;
    const t = setInterval(() => { void calls.current.heartbeat().catch(() => undefined); }, 20_000);
    return () => clearInterval(t);
  }, [phase, doctor]);
  useEffect(() => () => { void callRef.current?.destroy(); }, []);

  async function enter() {
    setError(null); setPhase('joining');
    try {
      const { url, token } = await calls.current.join(consent);
      const { default: Daily } = await import('@daily-co/daily-js');
      const call = Daily.createFrame(frameRef.current!, {
        iframeStyle: { width: '100%', height: '100%', border: '0', borderRadius: '12px' },
        showLeaveButton: true, showFullscreenButton: true, lang: 'es',
      });
      callRef.current = call;
      call.on('left-meeting', () => { void call.destroy(); callRef.current = null; setPhase('left'); void load(); });
      call.on('error', (e) => setError(e?.errorMsg ?? 'Se perdió la conexión con la sala'));
      await call.join({ url, token });
      setPhase('call');
    } catch (e) {
      setError(errorMessage(e)); setPhase('lobby');
      void callRef.current?.destroy(); callRef.current = null;
    }
  }

  if (!info) {
    return (<><Header /><main className="container narrow section">{error ? <div className="alert error" role="alert">{error}</div> : <p className="muted">Cargando…</p>}</main></>);
  }
  const tz = info.clinic.timezone;
  const needsConsent = !doctor && !info.consentGiven;
  const active = info.status === 'BOOKED';

  return (
    <>
      <Header>{doctor && <Link className="btn ghost" href="/panel">Volver a la agenda</Link>}</Header>
      <main className="container section stack">
        <div>
          <h1 style={{ marginBottom: 4 }}>Videoconsulta {doctor ? `con ${info.patientName}` : `con ${info.doctor.displayName}`}</h1>
          <p className="muted" style={{ margin: 0 }}>{info.serviceName} · {info.clinic.name} · {fmtDate(info.startsAt, tz)}, {fmtTime(info.startsAt, tz)} a {fmtTime(info.endsAt, tz)} h</p>
        </div>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div ref={frameRef} style={{ display: phase === 'call' || phase === 'joining' ? 'block' : 'none', height: 'min(78vh, 760px)' }} />

        {phase === 'lobby' && (
          <div className="card stack">
            {!info.available ? <div className="alert warn">{doctor ? 'Las videoconsultas aún no están activadas en Medora.' : `Las videoconsultas no están disponibles por ahora. Comunícate con la clínica${info.clinic.phone ? ` al ${info.clinic.phone}` : ''}.`}</div>
              : !active ? <div className="alert warn">{info.status === 'COMPLETED' ? 'Esta consulta ya se marcó como atendida.' : 'Esta cita ya no está vigente.'}</div>
              : !info.open ? (
                <div className="alert">
                  {new Date(info.opensAt) > new Date()
                    ? <>La sala abre a las <strong>{fmtTime(info.opensAt, tz)} h</strong> del {fmtDate(info.opensAt, tz)} (15 minutos antes). Deja esta página abierta: se actualiza sola.</>
                    : 'La sala de esta cita ya cerró.'}
                </div>
              ) : (
                <>
                  {doctor
                    ? <div className={`alert ${info.patientWaiting ? 'ok' : ''}`} role="status">{info.patientWaiting ? `${info.patientName} ya está en la sala de espera.` : 'El paciente aún no entra. Puedes abrir la sala y esperarlo ahí.'}</div>
                    : <p>Antes de entrar podrás probar tu cámara y tu micrófono. Usa un lugar privado y con buena conexión.</p>}
                  {needsConsent && (
                    <div className="stack" style={{ gap: 6 }}>
                      <strong>Consentimiento para la consulta a distancia</strong>
                      <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{info.consentText.map((t) => <li key={t}>{t}</li>)}</ul>
                      <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />Leí y acepto</label>
                    </div>
                  )}
                  <div><button className="primary" disabled={needsConsent && !consent} onClick={enter}>{doctor ? 'Abrir la sala' : 'Entrar a la sala'}</button></div>
                </>
              )}
          </div>
        )}
        {phase === 'joining' && <p className="muted" role="status">Conectando con la sala…</p>}
        {phase === 'left' && (
          <div className="card stack">
            <p>Saliste de la videoconsulta.</p>
            <div className="row">
              {info.open && active && <button onClick={() => setPhase('lobby')}>Volver a entrar</button>}
              {doctor ? <Link className="btn primary" href="/panel">Ir a la agenda para marcarla como atendida</Link>
                : <Link className="btn" href="/paciente">Ir a Mis citas</Link>}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
