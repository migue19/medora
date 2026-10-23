'use client';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage, staffSession } from '@/lib/api';
import { PasswordInput } from '@/components/PasswordInput';

export function Account() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get('newPassword') !== f.get('confirm')) { setMsg('Las contraseñas no coinciden'); return; }
    setMsg(null);
    try {
      await staffSession.patch('/api/me/password', { currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') });
      staffSession.clear();
      router.replace('/login');
    } catch (err) { setMsg(errorMessage(err)); }
  }
  return (
    <div className="stack">
    <CalendarSection />
    <PushSection />
    <form className="card stack narrow" onSubmit={submit}>
      <h3>Cambiar contraseña</h3>
      <label>Contraseña actual<PasswordInput name="currentPassword" required autoComplete="current-password" /></label>
      <label>Nueva contraseña<PasswordInput name="newPassword" required minLength={12} autoComplete="new-password" /></label>
      <label>Confirmar<PasswordInput name="confirm" required minLength={12} autoComplete="new-password" /></label>
      <p className="muted small">Al cambiarla se cierran todas tus sesiones.</p>
      {msg && <div className="alert error">{msg}</div>}
      <div><button className="primary">Cambiar</button></div>
    </form>
    </div>
  );
}

interface CalStatus {
  isDoctor: boolean;
  providers: { provider: 'GOOGLE' | 'MICROSOFT'; available: boolean; connection: { accountEmail: string; status: string; lastSyncAt: string | null; lastError: string | null; pushAppointments: boolean } | null }[];
}
const PROVIDER = { GOOGLE: { name: 'Google Calendar', path: 'google' }, MICROSOFT: { name: 'Outlook / Microsoft 365', path: 'microsoft' } } as const;

/** El médico conecta su calendario personal: sus eventos bloquean la agenda y sus citas aparecen ahí. */
function CalendarSection() {
  const [s, setS] = useState<CalStatus | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => staffSession.get<CalStatus>('/api/clinic/calendar').then(setS).catch(() => undefined);
  useEffect(() => {
    void load();
    const q = new URLSearchParams(window.location.search).get('calendario');
    if (q) {
      setMsg(q === 'conectado' ? { ok: true, text: 'Calendario conectado. Tus eventos ya bloquean tu agenda en línea.' }
        : q === 'cancelado' ? { ok: false, text: 'No se conectó el calendario.' } : { ok: false, text: 'No pudimos conectar el calendario. Inténtalo de nuevo.' });
      window.history.replaceState(null, '', '/panel?tab=account');
    }
  }, []);
  if (!s?.isDoctor) return null;
  async function act(fn: () => Promise<unknown>) {
    setMsg(null);
    try { await fn(); await load(); } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); }
  }
  return (
    <div className="card stack">
      <h3 style={{ margin: 0 }}>Mi calendario</h3>
      <p className="small muted" style={{ margin: 0 }}>Conecta tu calendario personal: tus eventos (cursos, consultas en otro lugar, vacaciones) bloquean tus horarios en línea en segundos, y tus citas de Medora aparecen en tu calendario. De tus eventos sólo guardamos el horario.</p>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="status">{msg.text}</div>}
      {s.providers.map((p) => (
        <div key={p.provider} className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <strong style={{ minWidth: 190 }}>{PROVIDER[p.provider].name}</strong>
          {!p.available ? <span className="small muted">Próximamente</span> : !p.connection ? (
            <button onClick={() => act(async () => { window.location.assign((await staffSession.post<{ url: string }>(`/api/clinic/calendar/${PROVIDER[p.provider].path}/start`, {})).url); })}>Conectar</button>
          ) : (
            <>
              <span className="small">{p.connection.accountEmail}{' '}
                {p.connection.status === 'ACTIVE' ? <span className="badge COMPLETED">Sincronizado</span> : <span className="badge CANCELLED">Vuelve a conectar</span>}
              </span>
              <label className="check small"><input type="checkbox" checked={p.connection.pushAppointments}
                onChange={(e) => act(() => staffSession.patch(`/api/clinic/calendar/${PROVIDER[p.provider].path}`, { pushAppointments: e.target.checked }))} />Copiar mis citas</label>
              {p.connection.status !== 'ACTIVE' && <button className="small" onClick={() => act(async () => { window.location.assign((await staffSession.post<{ url: string }>(`/api/clinic/calendar/${PROVIDER[p.provider].path}/start`, {})).url); })}>Reconectar</button>}
              <button className="ghost small danger" onClick={() => act(() => staffSession.del(`/api/clinic/calendar/${PROVIDER[p.provider].path}`))}>Desconectar</button>
              {p.connection.lastError && <span className="small" style={{ color: 'var(--danger)' }}>{p.connection.lastError}</span>}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Avisos en este dispositivo (nueva cita en línea, cancelación, paciente en la videoconsulta). */
function PushSection() {
  const [state, setState] = useState<'loading' | 'unsupported' | 'unavailable' | 'off' | 'on' | 'denied'>('loading');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setState('unsupported'); return; }
      const { publicKey } = await staffSession.get<{ publicKey: string | null }>('/api/clinic/push/key').catch(() => ({ publicKey: null }));
      if (!publicKey) { setState('unavailable'); return; }
      if (Notification.permission === 'denied') { setState('denied'); return; }
      const reg = await navigator.serviceWorker.getRegistration();
      setState((await reg?.pushManager.getSubscription()) ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
  }, []);
  async function enable() {
    setMsg(null);
    try {
      const { publicKey } = await staffSession.get<{ publicKey: string }>('/api/clinic/push/key');
      if ((await Notification.requestPermission()) !== 'granted') { setState('denied'); return; }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await staffSession.post('/api/clinic/push/subscribe', sub.toJSON());
      await staffSession.post('/api/clinic/push/test', {});
      setState('on');
    } catch (e) { setMsg(errorMessage(e)); }
  }
  async function disable() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await staffSession.request('DELETE', '/api/clinic/push/subscribe', { endpoint: sub.endpoint }).catch(() => undefined); await sub.unsubscribe(); }
    setState('off');
  }
  if (state === 'loading' || state === 'unavailable') return null;
  return (
    <div className="card stack">
      <h3 style={{ margin: 0 }}>Avisos en este dispositivo</h3>
      <p className="small muted" style={{ margin: 0 }}>Recibe un aviso cuando un paciente agenda o cancela en línea, o entra a la sala de videoconsulta. En iPhone, primero agrega Medora a tu pantalla de inicio (Compartir → Agregar a inicio).</p>
      {state === 'unsupported' && <p className="small">Este navegador no admite avisos.</p>}
      {state === 'denied' && <p className="small">Los avisos están bloqueados para Medora en este navegador; actívalos en la configuración del sitio.</p>}
      {state === 'off' && <div><button className="primary" onClick={enable}>Activar avisos</button></div>}
      {state === 'on' && <div className="row"><span className="badge COMPLETED">Activados</span><button className="ghost small" onClick={disable}>Desactivar</button></div>}
      {msg && <div className="alert error">{msg}</div>}
    </div>
  );
}
