'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, StaffSessionData, errorMessage, staffSession } from '@/lib/api';
import { PAYMENT_LABEL, PAY_METHOD_LABEL, STATUS_LABEL, addDays, fmtDay, fmtTime, money, todayIn } from '@/lib/format';
import { SlotPicker } from '@/components/SlotPicker';
import { NewAppointment } from './NewAppointment';
import type { Appointment, Doctor } from './shared';

export function Agenda({ session }: { session: StaffSessionData }) {
  const tz = session.clinic.timezone;
  const role = session.membership.role;
  const [date, setDate] = useState(() => todayIn(tz));
  const [days, setDays] = useState(1);
  const [doctorId, setDoctorId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState<false | { patient?: Appointment['patient']; followUp?: { id: string; doctorId: string; serviceId: string } }>(false);
  const [active, setActive] = useState<{ id: string; mode: 'cancel' | 'reschedule' } | null>(null);
  const canBook = role !== 'DOCTOR';
  /** Abre la sala el médico de la cita (o dirección), de 15 min antes a 30 min después. */
  const canVideo = (a: Appointment) => {
    const allowed = role === 'OWNER' || role === 'ADMIN' || (role === 'DOCTOR' && session.membership.doctorId === a.doctor.id);
    const now = Date.now();
    return allowed && now >= new Date(a.startsAt).getTime() - 15 * 60_000 && now <= new Date(a.endsAt).getTime() + 30 * 60_000;
  };

  useEffect(() => {
    staffSession.get<Doctor[]>('/api/clinic/doctors').then(setDoctors).catch(() => undefined);
    staffSession.get<{ id: string; name: string }[]>('/api/clinic/locations').then(setLocations).catch(() => undefined);
  }, []);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const q = new URLSearchParams({ from: date, days: String(days) });
      if (doctorId) q.set('doctorId', doctorId);
      if (locationId) q.set('locationId', locationId);
      const res = await staffSession.get<{ appointments: Appointment[] }>(`/api/clinic/appointments?${q}`);
      setAppointments(res.appointments);
    } catch (e) { setError(errorMessage(e)); }
  }, [date, days, doctorId, locationId]);

  // Con videoconsultas hoy, la agenda se actualiza sola para avisar cuando el paciente entra a la sala.
  const hasVideoToday = date === todayIn(tz) && (appointments ?? []).some((a) => a.modality === 'VIDEO' && a.status === 'BOOKED');
  useEffect(() => {
    if (!hasVideoToday) return;
    const t = setInterval(() => { if (!active && !creating) void reload(); }, 20_000);
    return () => clearInterval(t);
  }, [hasVideoToday, reload, active, creating]);
  const waiting = (appointments ?? []).filter((a) => a.patientWaiting && a.status === 'BOOKED' && canVideo(a)).length;
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = waiting ? `(${waiting}) ${base}` : base;
  }, [waiting]);

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
        {locations.length > 1 && (
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Todas las sedes</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        <span className="spacer" />
        <button onClick={() => void reload()}>Actualizar</button>
        {canBook && <button className="primary" onClick={() => setCreating({})}>Nueva cita</button>}
      </div>
      {role === 'DOCTOR' && !session.membership.doctorId && (
        <div className="alert warn">Tu usuario aún no está vinculado a un perfil de médico. Pide al administrador que lo vincule.</div>
      )}
      {creating && (
        <div className="card">
          <NewAppointment session={session} doctors={doctors} patient={creating.patient} followUp={creating.followUp} onClose={async (msg) => {
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
                    {a.status === 'BOOKED' && a.confirmedAt && <span className="badge COMPLETED">Confirmada por el paciente</span>}
                    {a.source === 'ONLINE' && <span className="badge">En línea</span>}
                    {a.followUpOfId && <span className="badge">Subsecuente</span>}
                    {a.channel && a.channel !== 'web' && <span className="badge">{CHANNEL_LABEL[a.channel] ?? a.channel}</span>}
                    {a.modality === 'VIDEO' && <span className="badge">Videoconsulta</span>}
                    {a.patientWaiting && a.status === 'BOOKED' && <span className="badge COMPLETED">Paciente en sala de espera</span>}
                    {a.payment && <span className={`badge ${a.payment.status === 'PAID' ? 'PAID' : ''}`}>{PAYMENT_LABEL[a.payment.status]} {money(a.payment.amountCents)}{a.payment.method ? ` · ${PAY_METHOD_LABEL[a.payment.method] ?? a.payment.method}` : ''}</span>}
                  </div>
                  {a.status === 'PENDING_PAYMENT' && a.paymentDueAt && <span className="small">Apartada: si no se paga antes de las {fmtTime(a.paymentDueAt, tz)} se libera sola.</span>}
                  <span className="small">{a.serviceName} · {a.doctor.displayName} · {money(a.priceCents)}</span>
                  {a.location && <span className="small muted">{a.location.name}{a.room ? ` · ${a.room.name}` : ''}</span>}
                  <span className="small muted"><a href={`tel:${a.patient.phone.replace(/[^+\d]/g, '')}`}>{a.patient.phone}</a>{a.patient.email ? ` · ${a.patient.email}` : ''}</span>
                  {a.patientNotes && <span className="small">Motivo: {a.patientNotes}</span>}
                  {a.cancelReason && <span className="small muted">Cancelación: {a.cancelReason}</span>}
                  {a.reminders.length > 0 && <Reminders logs={a.reminders} />}
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
                  {a.modality === 'VIDEO' && a.status === 'BOOKED' && canVideo(a) && (
                    <div className="row"><Link className="btn primary" href={`/consulta?cita=${a.id}&rol=medico`}>{a.doctorJoinedAt ? 'Volver a la videoconsulta' : 'Iniciar videoconsulta'}</Link></div>
                  )}
                  {a.status === 'PENDING_PAYMENT' && !started && (
                    <div className="row"><button className="danger" onClick={() => setActive({ id: a.id, mode: 'cancel' })}>Liberar apartado</button></div>
                  )}
                  {a.status === 'COMPLETED' && canBook && (
                    <div className="row">
                      <button onClick={() => { setCreating({ patient: a.patient, followUp: { id: a.id, doctorId: a.doctor.id, serviceId: a.serviceId } }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                        Agendar subsecuente
                      </button>
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

const CHANNEL: Record<string, string> = { EMAIL: 'correo', WHATSAPP: 'WhatsApp' };
const CHANNEL_LABEL: Record<string, string> = { widget: 'Desde su sitio web', google: 'Desde Google', instagram: 'Desde Instagram', directorio: 'Desde el directorio' };
const STATE: Record<string, string> = { SENT: 'enviado', FAILED: 'falló', SKIPPED: 'no enviado' };

function offsetLabel(minutes: number | null) {
  if (minutes === null) return '';
  return minutes % 1440 === 0 ? `${minutes / 1440} d` : minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
}

/** Último resultado de cada recordatorio (canal y anticipación) del horario vigente. */
function Reminders({ logs }: { logs: Appointment['reminders'] }) {
  const latest = new Map<string, Appointment['reminders'][number]>();
  for (const l of logs) latest.set(`${l.channel}:${l.offsetMinutes}`, l);
  return (
    <span className="small muted">
      Recordatorios: {[...latest.values()].map((l, i) => (
        <span key={i} title={l.error ?? undefined} style={l.status === 'FAILED' ? { color: 'var(--danger)' } : undefined}>
          {i > 0 ? ' · ' : ''}{CHANNEL[l.channel]} {offsetLabel(l.offsetMinutes)} {STATE[l.status]}{l.status !== 'SENT' && l.error ? ` (${l.error})` : ''}
        </span>
      ))}
    </span>
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
