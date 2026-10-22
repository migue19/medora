'use client';
import { FormEvent, useState } from 'react';
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
    <form className="card stack narrow" onSubmit={submit}>
      <h3>Cambiar contraseña</h3>
      <label>Contraseña actual<PasswordInput name="currentPassword" required autoComplete="current-password" /></label>
      <label>Nueva contraseña<PasswordInput name="newPassword" required minLength={12} autoComplete="new-password" /></label>
      <label>Confirmar<PasswordInput name="confirm" required minLength={12} autoComplete="new-password" /></label>
      <p className="muted small">Al cambiarla se cierran todas tus sesiones.</p>
      {msg && <div className="alert error">{msg}</div>}
      <div><button className="primary">Cambiar</button></div>
    </form>
  );
}
