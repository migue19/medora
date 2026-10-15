'use client';
import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { Session, errorMessage } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/format';
import { takeLinkToken } from '@/lib/link-token';

const anon = new Session('patient');

interface Invitation {
  clinic: { name: string; slug: string }; name: string; email: string; role: string; existingUser: boolean;
}

export function AcceptInvitation() {
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<Invitation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const t = takeLinkToken();
    if (!t) { setLoadError('El enlace está incompleto. Ábrelo directamente desde el correo.'); return; }
    setToken(t);
    anon.request<Invitation>('POST', '/api/auth/invitations/inspect', { token: t }, false)
      .then(setInfo)
      .catch((e) => setLoadError(errorMessage(e)));
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (!info!.existingUser && f.get('password') !== f.get('confirm')) { setError('Las contraseñas no coinciden'); return; }
    setBusy(true); setError(null);
    try {
      await anon.request('POST', '/api/auth/invitations/accept',
        info!.existingUser ? { token } : { token, password: f.get('password') }, false);
      setDone(true);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <>
      <Header />
      <main className="container narrow section">
        <div className="card stack">
          <h1>Invitación al equipo</h1>
          {loadError ? <div className="alert error" role="alert">{loadError}</div>
            : !info ? <p className="muted">Cargando…</p>
            : done ? (
              <>
                <div className="alert ok" role="status">Ya eres parte de {info.clinic.name}.</div>
                <p className="muted small">Para entrar usa el identificador de clínica <strong>{info.clinic.slug}</strong>.</p>
                <Link className="btn primary" href={`/login?clinica=${encodeURIComponent(info.clinic.slug)}`}>Iniciar sesión</Link>
              </>
            ) : (
              <form className="stack" onSubmit={submit}>
                <p><strong>{info.clinic.name}</strong> te invita como <strong>{ROLE_LABEL[info.role] ?? info.role}</strong>.</p>
                <p className="muted small">{info.name} · {info.email}</p>
                {info.existingUser ? (
                  <p className="muted small">Ya tienes una cuenta de Medora con este correo: entrarás con tu contraseña actual.</p>
                ) : (
                  <>
                    <label>Crea tu contraseña<input name="password" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /></label>
                    <label>Confirmar<input name="confirm" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /></label>
                    <p className="muted small">Mínimo 12 caracteres. Nadie más la conocerá, ni siquiera la clínica.</p>
                  </>
                )}
                {error && <div className="alert error" role="alert">{error}</div>}
                <button className="primary" disabled={busy}>{busy ? 'Un momento…' : 'Aceptar invitación'}</button>
              </form>
            )}
        </div>
      </main>
    </>
  );
}
