'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { Session, errorMessage } from '@/lib/api';
import { takeLinkToken } from '@/lib/link-token';

const anon = new Session('patient');

interface Info { clinic: { name: string }; patientName: string; phoneEnd: string; upcoming: number }

export function LinkRecord() {
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
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
    anon.request<Info>('POST', '/api/public/patient-links/inspect', { token: t }, false)
      .then(setInfo).catch((e) => setLoadError(errorMessage(e)));
  }, []);

  async function accept() {
    setBusy(true); setError(null);
    try {
      await anon.request('POST', '/api/public/patient-links/accept', { token }, false);
      setDone(true);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <Header />
      <main className="container narrow section">
        <div className="card stack">
          <h1>Vincular expediente</h1>
          {loadError ? <div className="alert error" role="alert">{loadError}</div> : !info ? <p className="muted">Cargando…</p> : done ? (
            <>
              <div className="alert ok" role="status">Listo. Tus citas de {info.clinic.name} ya aparecen en tu cuenta.</div>
              <Link className="btn primary" href="/paciente">Ver mis citas</Link>
            </>
          ) : (
            <>
              <p><strong>{info.clinic.name}</strong> tiene una ficha a nombre de <strong>{info.patientName}</strong> con teléfono terminado en <strong>{info.phoneEnd}</strong>{info.upcoming ? ` y ${info.upcoming} cita(s) próxima(s)` : ''}.</p>
              <p className="muted small">Si es tuya, confírmalo para verla en tu cuenta de Tepahti. Tus datos de contacto de la cuenta reemplazarán a los de la ficha.</p>
              {error && <div className="alert error" role="alert">{error}</div>}
              <div className="row">
                <button className="primary" disabled={busy} onClick={accept}>{busy ? 'Vinculando…' : 'Sí, es mía'}</button>
                <Link className="btn" href="/">No es mía</Link>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
