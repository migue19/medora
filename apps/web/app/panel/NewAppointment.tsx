'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError, StaffSessionData, errorMessage, staffSession } from '@/lib/api';
import { fmtDate, fmtTime, money, todayIn, uuid, zonedToUtcIso } from '@/lib/format';
import { SlotPicker } from '@/components/SlotPicker';
import type { ClinicPatient, Doctor, Service } from './shared';

interface Props {
  session: StaffSessionData;
  doctors: Doctor[];
  patient?: ClinicPatient;
  onClose: (msg?: string) => void;
  /** Cita atendida de la que se agenda la subsecuente (preselecciona médico y servicio). */
  followUp?: { id: string; doctorId: string; serviceId: string } | null;
}

export function NewAppointment({ session, doctors, patient: initialPatient, onClose, followUp }: Props) {
  const tz = session.clinic.timezone;
  const [patient, setPatient] = useState<ClinicPatient | null>(initialPatient ?? null);
  const [services, setServices] = useState<Service[]>([]);
  const [doctorId, setDoctorId] = useState(followUp?.doctorId ?? '');
  const [serviceId, setServiceId] = useState(followUp?.serviceId ?? '');
  const [slot, setSlot] = useState<string | null>(null);
  const [manualDate, setManualDate] = useState(todayIn(tz));
  const [manualTime, setManualTime] = useState('');
  const [notes, setNotes] = useState('');
  const [requestId, setRequestId] = useState(uuid);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { staffSession.get<Service[]>('/api/clinic/services').then(setServices).catch(() => undefined); }, []);

  const doctor = doctors.find((d) => d.id === doctorId);
  const doctorServices = services.filter((s) => s.active && doctor?.serviceIds.includes(s.id));
  const service = services.find((s) => s.id === serviceId);

  const load = useCallback(
    (from: string) => staffSession.get(`/api/clinic/doctors/${doctorId}/availability?serviceId=${serviceId}&from=${from}&days=7`),
    [doctorId, serviceId],
  );

  const manualIso = manualTime ? zonedToUtcIso(manualDate, manualTime, tz) : null;
  const startsAt = slot ?? manualIso;

  async function submit() {
    if (!patient || !doctorId || !serviceId || !startsAt) return;
    setBusy(true); setError(null);
    try {
      await staffSession.post('/api/clinic/appointments', {
        requestId, doctorId, serviceId, clinicPatientId: patient.id, startsAt, notes: notes.trim() || null,
        ...(followUp ? { followUpOfId: followUp.id } : {}),
      });
      onClose(`Cita agendada para ${patient.name}: ${fmtDate(startsAt, tz)} ${fmtTime(startsAt, tz)} h.`);
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 409) { setSlot(null); setRequestId(uuid()); setReloadKey((k) => k + 1); }
    } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <div className="row"><h2 style={{ margin: 0 }}>{followUp ? 'Cita subsecuente' : 'Nueva cita'}</h2><span className="spacer" /><button className="ghost" onClick={() => onClose()}>Cerrar</button></div>
      {!patient ? <PatientChooser onChoose={setPatient} /> : (
        <div className="row"><span>Paciente: <strong>{patient.name}</strong> · {patient.phone}</span>
          {!initialPatient && <button className="ghost small" onClick={() => setPatient(null)}>Cambiar</button>}</div>
      )}
      {patient && (
        <>
          <div className="grid">
            <label>Médico
              <select value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setServiceId(''); setSlot(null); }}>
                <option value="">Selecciona…</option>
                {doctors.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.displayName} · {d.specialty}</option>)}
              </select>
            </label>
            <label>Servicio
              <select value={serviceId} disabled={!doctor} onChange={(e) => { setServiceId(e.target.value); setSlot(null); setRequestId(uuid()); }}>
                <option value="">Selecciona…</option>
                {doctorServices.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.durationMinutes} min · {money(s.priceCents)}</option>)}
              </select>
            </label>
          </div>
          {doctor && doctorServices.length === 0 && <div className="alert warn">Este médico no tiene servicios asignados.</div>}
          {doctorId && serviceId && (
            <>
              <SlotPicker startDate={todayIn(tz)} load={load} reloadKey={reloadKey} selected={slot}
                onSelect={(s) => { setSlot(s); setManualTime(''); setRequestId(uuid()); }} />
              <details>
                <summary className="small">Agendar en una hora específica (dentro del horario del médico)</summary>
                <div className="row" style={{ marginTop: 8 }}>
                  <input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} style={{ width: 'auto' }} />
                  <input type="time" step={300} value={manualTime} onChange={(e) => { setManualTime(e.target.value); setSlot(null); setRequestId(uuid()); }} style={{ width: 'auto' }} />
                </div>
              </details>
              <label>Notas (opcional)<textarea value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></label>
              {startsAt && <p className="small">{fmtDate(startsAt, tz)} · {fmtTime(startsAt, tz)} h · {service?.name}</p>}
              {error && <div className="alert error" role="alert">{error}</div>}
              <button className="primary" disabled={!startsAt || busy} onClick={submit}>{busy ? 'Agendando…' : 'Agendar cita'}</button>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function PatientChooser({ onChoose }: { onChoose: (p: ClinicPatient) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ClinicPatient[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      staffSession.get<ClinicPatient[]>(`/api/clinic/patients?q=${encodeURIComponent(q)}`).then(setResults).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    try {
      const p = await staffSession.post<ClinicPatient>('/api/clinic/patients', {
        name: f.get('name'), phone: f.get('phone'), email: f.get('email'), whatsappConsent: f.get('whatsappConsent') === 'on',
      });
      onChoose(p);
    } catch (err) { setError(errorMessage(err)); }
  }

  return (
    <div className="stack">
      <label>Buscar paciente<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, teléfono o correo" /></label>
      <div className="stack" style={{ gap: 4 }}>
        {results.slice(0, 8).map((p) => (
          <button key={p.id} onClick={() => onChoose(p)} style={{ justifyContent: 'space-between' }}>
            <span>{p.name}</span><span className="muted small">{p.phone}{p.patientAccountId ? ' · cuenta en línea' : ''}</span>
          </button>
        ))}
        {results.length === 0 && <p className="muted small">Sin resultados.</p>}
      </div>
      {!creating ? <button onClick={() => setCreating(true)}>+ Registrar paciente nuevo</button> : (
        <form className="stack card" onSubmit={create}>
          <div className="grid">
            <label>Nombre<input name="name" required minLength={2} maxLength={120} defaultValue={q} /></label>
            <label>Teléfono<input name="phone" required inputMode="tel" pattern="\+?[0-9 \(\)\-]{8,20}" /></label>
            <label>Correo (opcional)<input name="email" type="email" /></label>
          </div>
          <label className="check"><input type="checkbox" name="whatsappConsent" />El paciente acepta recibir recordatorios por WhatsApp</label>
          {error && <div className="alert error">{error}</div>}
          <div className="row"><button className="primary">Guardar y continuar</button><button type="button" onClick={() => setCreating(false)}>Cancelar</button></div>
        </form>
      )}
    </div>
  );
}
