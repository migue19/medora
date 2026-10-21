'use client';
import { useEffect, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { ReviewForm } from '@/components/ReviewForm';
import { Session, errorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { takeLinkToken } from '@/lib/link-token';

const anon = new Session('patient');

interface Info {
  clinic: { name: string; timezone: string }; doctor: { displayName: string; specialty: string };
  serviceName: string; startsAt: string; patientName: string; publicName: string; alreadyReviewed: boolean;
}

export function LeaveReview() {
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const t = takeLinkToken();
    if (!t) { setLoadError('El enlace está incompleto. Ábrelo directamente desde el correo.'); return; }
    setToken(t);
    anon.request<Info>('POST', '/api/public/reviews/inspect', { token: t }, false).then(setInfo).catch((e) => setLoadError(errorMessage(e)));
  }, []);

  return (
    <>
      <Header />
      <main className="container narrow section">
        <div className="card stack">
          <h1>Tu opinión</h1>
          {loadError ? <div className="alert error" role="alert">{loadError}</div> : !info ? <p className="muted">Cargando…</p> : done ? (
            <div className="alert ok" role="status">¡Gracias, {info.patientName.split(' ')[0]}! Tu opinión ya está publicada en la página de {info.clinic.name}.</div>
          ) : info.alreadyReviewed ? (
            <div className="alert ok">Ya dejaste tu opinión sobre esta cita. ¡Gracias!</div>
          ) : (
            <>
              <p><strong>{info.doctor.displayName}</strong> · {info.doctor.specialty}</p>
              <p className="muted small">{info.serviceName} · {fmtDate(info.startsAt, info.clinic.timezone)} · {info.clinic.name}</p>
              <ReviewForm publicName={info.publicName} onSubmit={async (body) => {
                await anon.request('POST', '/api/public/reviews', { token, ...body }, false);
                setDone(true);
              }} />
            </>
          )}
        </div>
      </main>
    </>
  );
}
