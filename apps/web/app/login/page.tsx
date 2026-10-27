'use client';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import { ApiError, errorMessage, staffSession } from '@/lib/api';
import { PasswordInput } from '@/components/PasswordInput';

export default function StaffLogin() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState('');
  // Llega desde la invitación aceptada: /login?clinica=<slug>
  useEffect(() => {
    const clinica = new URLSearchParams(window.location.search).get('clinica');
    setSlug(clinica ?? '');
    // Con la sesión todavía abierta (p. ej. al volver desde el logo), entra directo al panel.
    if (!clinica) void staffSession.refresh().then((ok) => { if (ok) router.replace('/panel'); });
  }, [router]);

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
          <label>Clínica (identificador)<input name="clinicSlug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="mi-clinica" autoCapitalize="none"
            value={slug} onChange={(e) => setSlug(e.target.value)} /></label>
          <label>Correo<input name="email" type="email" required autoComplete="username" /></label>
          <label>Contraseña<PasswordInput name="password" required autoComplete="current-password" /></label>
          {error && <div className="alert error" role="alert">{error}</div>}
          <button className="primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
          <p className="small"><Link href="/recuperar?tipo=personal">¿Olvidaste tu contraseña?</Link></p>
          <p className="muted small">No hay registro público: el propietario o un administrador te invita por correo.</p>
        </form>
      </main>
    </>
  );
}
