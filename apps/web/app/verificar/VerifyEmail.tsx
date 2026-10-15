'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { errorMessage, patientSession } from '@/lib/api';
import { takeLinkToken } from '@/lib/link-token';

export function VerifyEmail() {
  const [state, setState] = useState<{ status: 'working' | 'ok' | 'error'; message?: string }>({ status: 'working' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = takeLinkToken();
    if (!token) { setState({ status: 'error', message: 'El enlace está incompleto. Ábrelo directamente desde el correo.' }); return; }
    patientSession.request('POST', '/api/patient/auth/verify-email', { token }, false)
      .then(async () => {
        if (patientSession.data) await patientSession.refresh();
        setState({ status: 'ok' });
      })
      .catch((e) => setState({ status: 'error', message: errorMessage(e) }));
  }, []);

  return (
    <>
      <Header />
      <main className="container narrow section">
        <div className="card stack">
          <h1>Confirmar correo</h1>
          {state.status === 'working' && <p className="muted">Confirmando…</p>}
          {state.status === 'ok' && (
            <>
              <div className="alert ok" role="status">¡Listo! Tu correo quedó confirmado y ya puedes reservar citas.</div>
              <p className="muted small">Si estabas reservando en otra pestaña, vuelve a ella y confirma tu cita.</p>
              <Link className="btn primary" href="/paciente">Ir a mis citas</Link>
            </>
          )}
          {state.status === 'error' && (
            <>
              <div className="alert error" role="alert">{state.message}</div>
              <p className="muted small">Desde <Link href="/paciente">Mis citas</Link> puedes pedir un enlace nuevo.</p>
            </>
          )}
        </div>
      </main>
    </>
  );
}
