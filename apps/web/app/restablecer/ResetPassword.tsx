'use client';
import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { Session, errorMessage, patientSession, staffSession } from '@/lib/api';
import { Audience, audienceFromQuery, takeLinkToken } from '@/lib/link-token';

const anon = new Session('patient');

export function ResetPassword() {
  const [audience, setAudience] = useState<Audience>('paciente');
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    // El token se lee una sola vez: al leerlo se quita de la URL.
    if (started.current) return;
    started.current = true;
    setAudience(audienceFromQuery());
    setToken(takeLinkToken());
  }, []);

  const minLength = audience === 'personal' ? 12 : 10;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get('password') !== f.get('confirm')) { setError('Las contraseñas no coinciden'); return; }
    setBusy(true); setError(null);
    try {
      await anon.request('POST', audience === 'personal' ? '/api/auth/reset' : '/api/patient/auth/reset',
        { token, password: f.get('password') }, false);
      // Todas las sesiones se revocaron en el servidor.
      (audience === 'personal' ? staffSession : patientSession).clear();
      setDone(true);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  const login = audience === 'personal' ? '/login' : '/paciente';
  return (
    <>
      <Header />
      <main className="container narrow section">
        <div className="card stack">
          <h1>Elige una contraseña nueva</h1>
          {token === undefined ? <p className="muted">Cargando…</p> : done ? (
            <>
              <div className="alert ok" role="status">Contraseña actualizada. Cerramos tus otras sesiones por seguridad.</div>
              <Link className="btn primary" href={login}>Iniciar sesión</Link>
            </>
          ) : !token ? (
            <>
              <div className="alert error" role="alert">El enlace está incompleto. Ábrelo directamente desde el correo.</div>
              <p className="small"><Link href={`/recuperar?tipo=${audience}`}>Pedir un enlace nuevo</Link></p>
            </>
          ) : (
            <form className="stack" onSubmit={submit}>
              <label>Nueva contraseña<input name="password" type="password" required minLength={minLength} maxLength={200} autoComplete="new-password" /></label>
              <label>Confirmar<input name="confirm" type="password" required minLength={minLength} maxLength={200} autoComplete="new-password" /></label>
              <p className="muted small">Mínimo {minLength} caracteres. Al cambiarla se cerrarán todas tus sesiones.</p>
              {error && (
                <div className="alert error" role="alert">
                  {error} {/venció/.test(error) && <Link href={`/recuperar?tipo=${audience}`}>Pedir otro enlace</Link>}
                </div>
              )}
              <button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button>
            </form>
          )}
        </div>
      </main>
    </>
  );
}
