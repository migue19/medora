'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { Session, errorMessage } from '@/lib/api';
import { fmtDate, fmtTime } from '@/lib/format';
import { takeLinkToken } from '@/lib/link-token';

const anon = new Session('patient');

interface Info {
  clinic: { name: string; phone: string | null; address: string | null; timezone: string };
  doctor: { displayName: string; specialty: string };
  patientName: string; serviceName: string; startsAt: string; status: string;
  confirmed: boolean; outdated: boolean; used: boolean; canConfirm: boolean; canCancel: boolean; cancelMinMinutes: number;
}

export function AppointmentAction() {
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<'confirmed' | 'cancelled' | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const t = takeLinkToken();
    if (!t) { setLoadError('El enlace está incompleto. Ábrelo directamente desde el recordatorio.'); return; }
    setToken(t);
    anon.request<Info>('POST', '/api/public/appointment-actions/inspect', { token: t }, false)
      .then(setInfo).catch((e) => setLoadError(errorMessage(e)));
  }, []);

  async function act(action: 'confirm' | 'cancel') {
    setBusy(true); setError(null);
    try {
      await anon.request('POST', `/api/public/appointment-actions/${action}`,
        action === 'cancel' ? { token, reason: reason.trim() || undefined } : { token }, false);
      setDone(action === 'confirm' ? 'confirmed' : 'cancelled');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  const contact = info?.clinic.phone ? ` al ${info.clinic.phone}` : '';
  return (
    <>
      <Header />
      <main className="container narrow section">
        <div className="card stack">
          <h1>Tu cita</h1>
          {loadError ? <div className="alert error" role="alert">{loadError}</div> : !info ? <p className="muted">Cargando…</p> : (
            <>
              <p><strong>{info.clinic.name}</strong> · {info.doctor.displayName} ({info.doctor.specialty})</p>
              <p className="muted">{info.serviceName} · {info.patientName}</p>
              <p><strong>{fmtDate(info.startsAt, info.clinic.timezone)}</strong> a las <strong>{fmtTime(info.startsAt, info.clinic.timezone)}</strong> h</p>
              {info.clinic.address && <p className="small muted">{info.clinic.address}</p>}

              {done === 'confirmed' ? <div className="alert ok" role="status">¡Gracias! Confirmaste tu asistencia. Te esperamos.</div>
                : done === 'cancelled' ? <div className="alert ok" role="status">Tu cita quedó cancelada. Te enviamos la confirmación por correo.</div>
                : info.status === 'CANCELLED' ? <div className="alert warn">Esta cita está cancelada.</div>
                : info.status !== 'BOOKED' ? <div className="alert warn">Esta cita ya no está vigente.</div>
                : info.outdated ? <div className="alert warn">Tu cita cambió de horario después de este recordatorio. Usa el enlace del recordatorio más reciente o revisa <Link href="/paciente">Mis citas</Link>.</div>
                : (
                  <>
                    {info.confirmed && <div className="alert ok">Ya confirmaste tu asistencia.</div>}
                    {info.used && !info.confirmed && <div className="alert warn">Este enlace ya se usó.</div>}
                    {error && <div className="alert error" role="alert">{error}</div>}
                    {cancelling ? (
                      <div className="stack">
                        <label>Motivo (opcional)<input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Ej. no podré llegar" /></label>
                        <div className="row">
                          <button className="danger" disabled={busy} onClick={() => act('cancel')}>{busy ? 'Cancelando…' : 'Sí, cancelar mi cita'}</button>
                          <button onClick={() => setCancelling(false)}>Volver</button>
                        </div>
                      </div>
                    ) : (
                      <div className="row">
                        {info.canConfirm && <button className="primary" disabled={busy} onClick={() => act('confirm')}>{busy ? 'Confirmando…' : 'Confirmar asistencia'}</button>}
                        {info.canCancel && <button className="danger" disabled={busy} onClick={() => setCancelling(true)}>Cancelar cita</button>}
                      </div>
                    )}
                    {!info.canCancel && !info.used && (
                      <p className="small muted">
                        Ya no es posible cancelar en línea (el plazo es de {Math.round(info.cancelMinMinutes / 6) / 10} h antes). Si no puedes asistir, comunícate con la clínica{contact}.
                      </p>
                    )}
                  </>
                )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
