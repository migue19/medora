'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { ApiError, errorMessage, staffSession } from '@/lib/api';

export default function StaffLogin() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      const res = await staffSession.request('POST', '/api/auth/login', {
        clinicSlug: String(f.get('clinicSlug') ?? '').trim().toLowerCase(),
        email: f.get('email'), password: f.get('password'),
      }, false);
      staffSession.set(res);
      router.push('/panel');
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Correo, contraseña o clínica incorrectos' : errorMessage(err));
    } finally { setBusy(false); }
  }

  return (
    <>
      <Header />
      <main className="container narrow section">
        <form className="card stack" onSubmit={submit}>
          <h1>Acceso para clínicas</h1>
          <label>Clínica (identificador)<input name="clinicSlug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="mi-clinica" autoCapitalize="none" /></label>
          <label>Correo<input name="email" type="email" required autoComplete="username" /></label>
          <label>Contraseña<input name="password" type="password" required autoComplete="current-password" /></label>
          {error && <div className="alert error" role="alert">{error}</div>}
          <button className="primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
          <p className="muted small">No hay registro público: el propietario de la clínica da de alta al equipo.</p>
        </form>
      </main>
    </>
  );
}
