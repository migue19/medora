'use client';
import { useCallback, useEffect, useState } from 'react';
import { StaffSessionData, errorMessage, staffSession } from '@/lib/api';
import { fmtDate, fmtTime } from '@/lib/format';
import type { Doctor, Service } from './shared';

interface Entry {
  id: string; doctorId: string; serviceId: string; fromDate: string | null; toDate: string | null; notes: string | null;
  createdAt: string; createdByKind: 'STAFF' | 'PATIENT';
  clinicPatient: { id: string; name: string; phone: string; email: string | null };
  offer: { id: string; startsAt: string; endsAt: string; expiresAt: string } | null;
}

export function Waitlist({ session }: { session: StaffSessionData }) {
  const tz = session.clinic.timezone;
  const canEdit = session.membership.role !== 'DOCTOR';
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [doctorId, setDoctorId] = useState('');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    staffSession.get<Doctor[]>('/api/clinic/doctors').then(setDoctors).catch(() => undefined);
    staffSession.get<Service[]>('/api/clinic/services').then(setServices).catch(() => undefined);
  }, []);
  const load = useCallback(async () => {
    try {
      setEntries(await staffSession.get<Entry[]>(`/api/clinic/waitlist${doctorId ? `?doctorId=${doctorId}` : ''}`));
    } catch (e) { setError(errorMessage(e)); }
  }, [doctorId]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setError(null); setNotice(null);
    try { await fn(); setNotice(ok); await load(); } catch (e) { setError(errorMessage(e)); await load(); }
  }

  const doctorName = (id: string) => doctors.find((d) => d.id === id)?.displayName ?? '';
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? '';
  const position = new Map<string, number>();

  return (
    <div className="stack">
      <p className="muted small">Cuando se cancela o reprograma una cita, el horario se aparta 2 horas a la primera persona compatible de la lista del médico y se le avisa por correo. Si rechaza o no responde, pasa a la siguiente. Los pacientes sin correo aparecen aquí con su apartado para que los llames.</p>
      <div className="row">
        {session.membership.role !== 'DOCTOR' && (
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Todos los médicos</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
          </select>
        )}
        <span className="spacer" />
        <button onClick={() => void load()}>Actualizar</button>
      </div>
      {notice && <div className="alert ok" role="status">{notice}</div>}
      {error && <div className="alert error" role="alert">{error}</div>}
      {entries && entries.length === 0 && <p className="muted">No hay nadie en lista de espera. Agrega pacientes desde su ficha en «Pacientes».</p>}
      {entries?.map((e) => {
        const n = (position.get(e.doctorId) ?? 0) + 1;
        position.set(e.doctorId, n);
        return (
          <div key={e.id} className="appt">
            <div className="appt-time">#{n}</div>
            <div className="appt-body stack" style={{ gap: 4 }}>
              <div className="row">
                <strong>{e.clinicPatient.name}</strong>
                {e.createdByKind === 'PATIENT' && <span className="badge">Se anotó en línea</span>}
                {e.offer && <span className="badge NO_SHOW">Horario apartado</span>}
              </div>
              <span className="small">{doctorName(e.doctorId)} · {serviceName(e.serviceId)}{e.fromDate || e.toDate ? ` · del ${e.fromDate ?? '…'} al ${e.toDate ?? '…'}` : ''}</span>
              <span className="small muted"><a href={`tel:${e.clinicPatient.phone.replace(/[^+\d]/g, '')}`}>{e.clinicPatient.phone}</a>{e.clinicPatient.email ? ` · ${e.clinicPatient.email}` : ' · sin correo'} · desde {fmtDate(e.createdAt, tz)}</span>
              {e.notes && <span className="small">Notas: {e.notes}</span>}
              {e.offer && (
                <div className="alert warn stack">
                  <span>Apartado: <strong>{fmtDate(e.offer.startsAt, tz)} {fmtTime(e.offer.startsAt, tz)} h</strong>, hasta las {fmtTime(e.offer.expiresAt, tz)} h{e.clinicPatient.email ? ' (se le avisó por correo)' : ' (llámale para confirmar)'}.</span>
                  {canEdit && (
                    <div className="row">
                      <button className="primary" onClick={() => run(() => staffSession.post(`/api/clinic/waitlist/offers/${e.offer!.id}/accept`), `Cita agendada para ${e.clinicPatient.name}.`)}>Agendar este horario</button>
                      <button onClick={() => run(() => staffSession.post(`/api/clinic/waitlist/offers/${e.offer!.id}/release`), 'Apartado liberado; se ofrecerá a la siguiente persona.')}>No le sirve</button>
                    </div>
                  )}
                </div>
              )}
              {canEdit && (
                <div className="row">
                  <button className="danger" onClick={() => { if (window.confirm(`¿Quitar a ${e.clinicPatient.name} de la lista?`)) void run(() => staffSession.post(`/api/clinic/waitlist/${e.id}/remove`), 'Salió de la lista de espera.'); }}>Quitar de la lista</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
