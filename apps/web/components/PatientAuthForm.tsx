'use client';
import { FormEvent, useState } from 'react';
import { ApiError, errorMessage, patientSession } from '@/lib/api';

export function PatientAuthForm({ onDone }: { onDone?: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const body = mode === 'login'
        ? { email: f.get('email'), password: f.get('password') }
        : { name: f.get('name'), email: f.get('email'), phone: f.get('phone'), password: f.get('password') };
      const res = await patientSession.request('POST', `/api/patient/auth/${mode}`, body, false);
      patientSession.set(res);
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Correo o contraseña incorrectos' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => setMode('login')}>Iniciar sesión</button>
        <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => setMode('register')}>Crear cuenta</button>
      </div>
      {mode === 'register' && (
        <>
          <label>Nombre completo<input name="name" required minLength={2} maxLength={120} autoComplete="name" /></label>
          <label>Teléfono<input name="phone" required inputMode="tel" pattern="\+?[0-9 \(\)\-]{8,20}" autoComplete="tel" /></label>
        </>
      )}
      <label>Correo electrónico<input name="email" type="email" required autoComplete="email" /></label>
      <label>Contraseña
        <input name="password" type="password" required minLength={mode === 'register' ? 10 : 1}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
      </label>
      {mode === 'register' && <p className="muted small">Mínimo 10 caracteres. Tus datos sólo se comparten con las clínicas donde reservas.</p>}
      {error && <div className="alert error" role="alert">{error}</div>}
      <button className="primary" disabled={busy}>{busy ? 'Un momento…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}</button>
    </form>
  );
}
