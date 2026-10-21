'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { Session, errorMessage } from '@/lib/api';
import { fmtDate, fmtTime, money } from '@/lib/format';
import { takeLinkToken } from '@/lib/link-token';

const anon = new Session('patient');

interface Offer {
  clinic: { name: string; address: string | null; phone: string | null; timezone: string };
  doctor: { displayName: string; specialty: string };
  service: { name: string; durationMinutes: number; priceCents: number };
  patientName: string; startsAt: string; expiresAt: string; status: string; open: boolean;
}

export function WaitlistOffer() {
  const [token, setToken] = useState<string | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'accepted' | 'declined' | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const t = takeLinkToken();
    if (!t) { setLoadError('El enlace está incompleto. Ábrelo directamente desde el correo.'); return; }
    setToken(t);
    anon.request<Offer>('POST', '/api/public/waitlist-offers/inspect', { token: t }, false)
      .then(setOffer).catch((e) => setLoadError(errorMessage(e)));
  }, []);

  async function act(action: 'accept' | 'decline') {
    setBusy(true); setError(null);
    try {
      await anon.request('POST', `/api/public/waitlist-offers/${action}`, { token }, false);
      setDone(action === 'accept' ? 'accepted' : 'declined');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  const tz = offer?.clinic.timezone ?? 'America/Mexico_City';
  return (
    <>
      <Header />
      <main className="container narrow section">
        <div className="card stack">
          <h1>Se liberó un horario</h1>
          {loadError ? <div className="alert error" role="alert">{loadError}</div> : !offer ? <p className="muted">Cargando…</p> : (
            <>
              <p><strong>{offer.clinic.name}</strong> · {offer.doctor.displayName} ({offer.doctor.specialty})</p>
              <p className="muted">{offer.service.name} · {offer.service.durationMinutes} min · {money(offer.service.priceCents)} · {offer.patientName}</p>
              <p><strong>{fmtDate(offer.startsAt, tz)}</strong> a las <strong>{fmtTime(offer.startsAt, tz)}</strong> h</p>
              {offer.clinic.address && <p className="small muted">{offer.clinic.address}</p>}
              {done === 'accepted' ? (
                <>
                  <div className="alert ok" role="status">¡Listo! Tu cita quedó agendada. Te enviamos la confirmación por correo.</div>
                  <Link className="btn" href="/paciente">Ver mis citas</Link>
                </>
              ) : done === 'declined' ? (
                <div className="alert ok" role="status">Gracias por avisar. Sigues en la lista de espera para el siguiente horario.</div>
              ) : offer.status === 'ACCEPTED' ? (
                <div className="alert ok">Ya aceptaste este horario. Tu cita está agendada.</div>
              ) : !offer.open ? (
                <div className="alert warn">Este horario ya no está apartado para ti{offer.status === 'EXPIRED' ? ' porque venció el plazo' : ''}. Sigues en la lista de espera{offer.clinic.phone ? `; si tienes dudas llama al ${offer.clinic.phone}` : ''}.</div>
              ) : (
                <>
                  <p className="small">Está apartado para ti hasta las <strong>{fmtTime(offer.expiresAt, tz)} h</strong>. Después se ofrecerá a la siguiente persona.</p>
                  {error && <div className="alert error" role="alert">{error}</div>}
                  <div className="row">
                    <button className="primary" disabled={busy} onClick={() => act('accept')}>{busy ? 'Un momento…' : 'Aceptar este horario'}</button>
                    <button disabled={busy} onClick={() => act('decline')}>No me sirve</button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
