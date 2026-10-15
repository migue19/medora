'use client';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { Session, errorMessage } from '@/lib/api';
import { Audience, audienceFromQuery } from '@/lib/link-token';

const anon = new Session('patient');

export function ForgotPassword() {
  const [audience, setAudience] = useState<Audience>('paciente');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setAudience(audienceFromQuery()); }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email') ?? '').trim();
    setBusy(true); setError(null);
    try {
      await anon.request('POST', audience === 'personal' ? '/api/auth/forgot' : '/api/patient/auth/forgot', { email }, false);
      setSentTo(email);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  const back = audience === 'personal' ? '/login' : '/paciente';
  return (
    <>
      <Header />
      <main className="container narrow section">
        <div className="card stack">
          <h1>Recuperar contraseña</h1>
          <p className="muted">{audience === 'personal' ? 'Cuenta del personal de la clínica.' : 'Cuenta de paciente.'}</p>
          {sentTo ? (
            <>
              <div className="alert ok" role="status">
                Si <strong>{sentTo}</strong> tiene una cuenta, te enviamos un enlace para elegir una contraseña nueva. Vence en 30 minutos.
              </div>
              <p className="muted small">¿No llegó? Revisa spam o vuelve a intentarlo en unos minutos.</p>
            </>
          ) : (
            <form className="stack" onSubmit={submit}>
              <label>Correo electrónico<input name="email" type="email" required autoComplete="email" /></label>
              {error && <div className="alert error" role="alert">{error}</div>}
              <button className="primary" disabled={busy}>{busy ? 'Enviando…' : 'Enviar enlace'}</button>
            </form>
          )}
          <p className="small"><Link href={back}>Volver a iniciar sesión</Link></p>
        </div>
      </main>
    </>
  );
}
