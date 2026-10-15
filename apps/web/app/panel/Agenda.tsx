'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, StaffSessionData, errorMessage, staffSession } from '@/lib/api';
import { STATUS_LABEL, addDays, fmtDay, fmtTime, money, todayIn } from '@/lib/format';
import { SlotPicker } from '@/components/SlotPicker';
import { NewAppointment } from './NewAppointment';
import type { Appointment, Doctor } from './shared';

export function Agenda({ session }: { session: StaffSessionData }) {
  const tz = session.clinic.timezone;
  const role = session.membership.role;
  const [date, setDate] = useState(() => todayIn(tz));
  const [days, setDays] = useState(1);
  const [doctorId, setDoctorId] = useState('');
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [active, setActive] = useState<{ id: string; mode: 'cancel' | 'reschedule' } | null>(null);
  const canBook = role !== 'DOCTOR';

  useEffect(() => { staffSession.get<Doctor[]>('/api/clinic/doctors').then(setDoctors).catch(() => undefined); }, []);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const q = new URLSearchParams({ from: date, days: String(days) });
      if (doctorId) q.set('doctorId', doctorId);
      const res = await staffSession.get<{ appointments: Appointment[] }>(`/api/clinic/appointments?${q}`);
      setAppointments(res.appointments);
    } catch (e) { setError(errorMessage(e)); }
  }, [date, days, doctorId]);

  useEffect(() => { void reload(); }, [reload]);

  async function outcome(a: Appointment, status: 'COMPLETED' | 'NO_SHOW') {
    setError(null); setNotice(null);
    try {
      await staffSession.post(`/api/clinic/appointments/${a.id}/outcome`, { status, expectedStatus: 'BOOKED' });
      await reload();
    } catch (e) { setError(errorMessage(e)); }
  }

  const grouped = new Map<string, Appointment[]>();
  for (const a of appointments ?? []) {
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(a.startsAt));
    grouped.set(key, [...(grouped.get(key) ?? []), a]);
  }
  const booked = (appointments ?? []).filter((a) => a.status === 'BOOKED').length;

  return (
    <div className="stack">
      <div className="row">
        <button onClick={() => setDate(addDays(date, -days))} aria-label="Anterior">←</button>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 'auto' }} />
        <button onClick={() => setDate(addDays(date, days))} aria-label="Siguiente">→</button>
        <button onClick={() => setDate(todayIn(tz))}>Hoy</button>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 'auto' }}>
          <option value={1}>Día</option><option value={7}>Semana</option>
        </select>
        {role !== 'DOCTOR' && (
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Todos los médicos</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
          </select>
        )}
        <span className="spacer" />
        <button onClick={() => void reload()}>Actualizar</button>
        {canBook && <button className="primary" onClick={() => setCreating(true)}>Nueva cita</button>}
      </div>
      {role === 'DOCTOR' && !session.membership.doctorId && (
        <div className="alert warn">Tu usuario aún no está vinculado a un perfil de médico. Pide al administrador que lo vincule.</div>
      )}
      {creating && (
        <div className="card">
          <NewAppointment session={session} doctors={doctors} onClose={async (msg) => {
            setCreating(false); if (msg) { setNotice(msg); await reload(); }
          }} />
        </div>
      )}
      {notice && <div className="alert ok" role="status">{notice}</div>}
      {error && <div className="alert error" role="alert">{error}</div>}
      {appointments && <p className="muted small">{booked} cita(s) agendada(s) · {appointments.length} en total</p>}
      {appointments && appointments.length === 0 && <p className="muted">Sin citas en este periodo.</p>}
      {[...grouped.entries()].map(([day, list]) => (
        <section key={day} className="stack">
          {days > 1 && <h3>{fmtDay(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>}
          {list.map((a) => {
            const started = new Date(a.startsAt).getTime() <= Date.now();
            return (
              <div key={a.id} className="appt" style={{ opacity: a.status === 'CANCELLED' ? 0.65 : 1 }}>
                <div className="appt-time">{fmtTime(a.startsAt, tz)}<div className="muted small">{fmtTime(a.endsAt, tz)}</div></div>
                <div className="appt-body stack" style={{ gap: 4 }}>
                  <div className="row">
                    <strong>{a.patient.name}</strong>
                    <span className={`badge ${a.status}`}>{STATUS_LABEL[a.status]}</span>
                    {a.source === 'ONLINE' && <span className="badge">En línea</span>}
                  </div>
                  <span className="small">{a.serviceName} · {a.doctor.displayName} · {money(a.priceCents)}</span>
                  <span className="small muted"><a href={`tel:${a.patient.phone.replace(/[^+\d]/g, '')}`}>{a.patient.phone}</a>{a.patient.email ? ` · ${a.patient.email}` : ''}</span>
                  {a.patientNotes && <span className="small">Motivo: {a.patientNotes}</span>}
                  {a.cancelReason && <span className="small muted">Cancelación: {a.cancelReason}</span>}
                  {a.status === 'BOOKED' && (
                    <div className="row">
                      {started ? (
                        <>
                          <button onClick={() => outcome(a, 'COMPLETED')}>Atendida</button>
                          <button onClick={() => outcome(a, 'NO_SHOW')}>No asistió</button>
                        </>
                      ) : (
                        <>
                          {canBook && <button onClick={() => setActive({ id: a.id, mode: 'reschedule' })}>Reprogramar</button>}
                          <button className="danger" onClick={() => setActive({ id: a.id, mode: 'cancel' })}>Cancelar</button>
                        </>
                      )}
                    </div>
                  )}
                  {active?.id === a.id && active.mode === 'cancel' && (
                    <CancelForm a={a} onDone={async (msg) => { setActive(null); if (msg) { setNotice(msg); await reload(); } }} />
                  )}
                  {active?.id === a.id && active.mode === 'reschedule' && (
                    <RescheduleForm a={a} tz={tz} onDone={async (msg) => { setActive(null); if (msg) { setNotice(msg); await reload(); } }} />
                  )}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function CancelForm({ a, onDone }: { a: Appointment; onDone: (msg?: string) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError(null);
    try {
      await staffSession.post(`/api/clinic/appointments/${a.id}/cancel`, { reason });
      onDone('Cita cancelada.');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <label>Motivo de cancelación<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Ej. paciente llamó para cancelar" /></label>
      {error && <div className="alert error">{error}</div>}
      <div className="row">
        <button className="danger" disabled={busy || reason.trim().length < 2} onClick={submit}>Confirmar cancelación</button>
        <button onClick={() => onDone()}>Volver</button>
      </div>
    </div>
  );
}

function RescheduleForm({ a, tz, onDone }: { a: Appointment; tz: string; onDone: (msg?: string) => void }) {
  const [slot, setSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(
    (from: string) => staffSession.get(`/api/clinic/doctors/${a.doctor.id}/availability?serviceId=${a.serviceId}&from=${from}&days=7`),
    [a.doctor.id, a.serviceId],
  );
  async function submit() {
    if (!slot) return;
    setBusy(true); setError(null);
    try {
      await staffSession.post(`/api/clinic/appointments/${a.id}/reschedule`, { startsAt: slot, expectedStartsAt: a.startsAt });
      onDone('Cita reprogramada.');
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 409) { setSlot(null); setReloadKey((k) => k + 1); }
    } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <SlotPicker startDate={todayIn(tz)} load={load} reloadKey={reloadKey} selected={slot} onSelect={(s) => setSlot(s)} />
      {error && <div className="alert error">{error}</div>}
      <div className="row">
        <button className="primary" disabled={!slot || busy} onClick={submit}>{slot ? `Mover a ${fmtTime(slot, tz)} h` : 'Elige un horario'}</button>
        <button onClick={() => onDone()}>Volver</button>
      </div>
    </div>
  );
}
