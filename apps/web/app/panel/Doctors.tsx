'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { StaffSessionData, errorMessage, staffSession } from '@/lib/api';
import { WEEKDAYS, fmtDate, fmtTime, hhmmToMinutes, minutesToHHMM, todayIn, zonedToUtcIso } from '@/lib/format';
import type { Doctor, Rule, Service } from './shared';

interface Member { id: string; role: string; active: boolean; user: { name: string; email: string }; doctor: { id: string } | null }

export function Doctors({ session }: { session: StaffSessionData }) {
  const role = session.membership.role;
  const isAdmin = role === 'OWNER' || role === 'ADMIN';
  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [editing, setEditing] = useState<Doctor | 'new' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([
        staffSession.get<Doctor[]>('/api/clinic/doctors'),
        staffSession.get<Service[]>('/api/clinic/services'),
      ]);
      setDoctors(d); setServices(s);
      if (isAdmin) setMembers(await staffSession.get<Member[]>('/api/clinic/members'));
    } catch (e) { setError(errorMessage(e)); }
  }, [isAdmin]);

  useEffect(() => { void reload(); }, [reload]);

  const visible = role === 'DOCTOR' ? (doctors ?? []).filter((d) => d.id === session.membership.doctorId) : doctors ?? [];
  const current = visible.find((d) => d.id === selected) ?? null;

  return (
    <div className="stack">
      {error && <div className="alert error">{error}</div>}
      {isAdmin && !editing && <div><button className="primary" onClick={() => setEditing('new')}>+ Agregar médico</button></div>}
      {editing && (
        <DoctorForm doctor={editing === 'new' ? null : editing} services={services} members={members}
          onDone={async () => { setEditing(null); await reload(); }} />
      )}
      {doctors && visible.length === 0 && <p className="muted">{role === 'DOCTOR' ? 'Tu usuario no está vinculado a un perfil de médico.' : 'Aún no hay médicos.'}</p>}
      <div className="grid">
        {visible.map((d) => (
          <div key={d.id} className="card stack" style={{ opacity: d.active ? 1 : 0.6 }}>
            <div>
              <h3 style={{ margin: 0 }}>{d.displayName} {!d.active && <span className="badge">Inactivo</span>}</h3>
              <div className="muted small">{d.specialty}{d.licenseNumber ? ` · Céd. ${d.licenseNumber}` : ''}</div>
              {d.membership && <div className="muted small">Usuario: {d.membership.user.email}</div>}
            </div>
            <div className="small">
              {services.filter((s) => d.serviceIds.includes(s.id)).map((s) => s.name).join(', ') || <span className="muted">Sin servicios</span>}
            </div>
            <div className="small muted">{summarizeRules(d.rules)}</div>
            <div className="row">
              <button onClick={() => setSelected(selected === d.id ? null : d.id)}>{selected === d.id ? 'Cerrar' : 'Horario y bloqueos'}</button>
              {isAdmin && <button className="ghost" onClick={() => setEditing(d)}>Editar</button>}
            </div>
          </div>
        ))}
      </div>
      {current && (
        <div className="card stack">
          <h2>{current.displayName}</h2>
          <ScheduleEditor doctor={current} canEdit={isAdmin || current.id === session.membership.doctorId} onSaved={reload} />
          <TimeOffEditor doctor={current} tz={session.clinic.timezone} canEdit={role !== 'DOCTOR' || current.id === session.membership.doctorId} />
        </div>
      )}
    </div>
  );
}

function summarizeRules(rules: Rule[]): string {
  if (!rules.length) return 'Sin horario configurado';
  const days = [...new Set(rules.map((r) => r.weekday))].sort();
  return days.map((w) => `${WEEKDAYS[w - 1].slice(0, 3)} ${rules.filter((r) => r.weekday === w).map((r) => `${minutesToHHMM(r.startMinute)}–${minutesToHHMM(r.endMinute)}`).join(', ')}`).join(' · ');
}

function DoctorForm({ doctor, services, members, onDone }: { doctor: Doctor | null; services: Service[]; members: Member[]; onDone: () => void }) {
  const [serviceIds, setServiceIds] = useState<string[]>(doctor?.serviceIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const doctorMembers = members.filter((m) => m.role === 'DOCTOR' && m.active && (!m.doctor || m.doctor.id === doctor?.id));

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      displayName: f.get('displayName'), specialty: f.get('specialty'), licenseNumber: f.get('licenseNumber'),
      bio: f.get('bio'), serviceIds, membershipId: (f.get('membershipId') as string) || null,
    };
    if (doctor) body.active = f.get('active') === 'on';
    setBusy(true); setError(null);
    try {
      if (doctor) await staffSession.patch(`/api/clinic/doctors/${doctor.id}`, body);
      else await staffSession.post('/api/clinic/doctors', body);
      onDone();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>{doctor ? 'Editar médico' : 'Nuevo médico'}</h2>
      <div className="grid">
        <label>Nombre a mostrar<input name="displayName" required minLength={2} maxLength={120} defaultValue={doctor?.displayName} placeholder="Dra. Ana López" /></label>
        <label>Especialidad<input name="specialty" required minLength={2} maxLength={120} defaultValue={doctor?.specialty} /></label>
        <label>Cédula profesional<input name="licenseNumber" maxLength={30} defaultValue={doctor?.licenseNumber ?? ''} /></label>
        <label>Usuario vinculado (rol Médico)
          <select name="membershipId" defaultValue={doctor?.membership?.id ?? ''}>
            <option value="">Sin usuario</option>
            {doctorMembers.map((m) => <option key={m.id} value={m.id}>{m.user.name} · {m.user.email}</option>)}
          </select>
        </label>
      </div>
      <label>Presentación (se muestra a pacientes)<textarea name="bio" maxLength={1000} defaultValue={doctor?.bio ?? ''} /></label>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 600 }}>Servicios que ofrece</legend>
        {services.filter((s) => s.active || serviceIds.includes(s.id)).map((s) => (
          <label key={s.id} className="check"><input type="checkbox" checked={serviceIds.includes(s.id)}
            onChange={(e) => setServiceIds(e.target.checked ? [...serviceIds, s.id] : serviceIds.filter((x) => x !== s.id))} />{s.name}</label>
        ))}
        {services.length === 0 && <p className="muted small">Primero crea servicios en la pestaña Servicios.</p>}
      </fieldset>
      {doctor && <label className="check"><input type="checkbox" name="active" defaultChecked={doctor.active} />Activo (visible para reservas)</label>}
      {error && <div className="alert error">{error}</div>}
      <div className="row"><button className="primary" disabled={busy}>Guardar</button><button type="button" onClick={onDone}>Cancelar</button></div>
    </form>
  );
}

interface EditableRule { weekday: number; start: string; end: string }

function ScheduleEditor({ doctor, canEdit, onSaved }: { doctor: Doctor; canEdit: boolean; onSaved: () => void }) {
  const toEditable = (rules: Rule[]) => rules.map((r) => ({ weekday: r.weekday, start: minutesToHHMM(r.startMinute), end: minutesToHHMM(r.endMinute) }));
  const [rules, setRules] = useState<EditableRule[]>(toEditable(doctor.rules));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setRules(toEditable(doctor.rules)); setMsg(null); }, [doctor]);

  async function save() {
    setMsg(null);
    const parsed = rules.map((r) => ({ weekday: r.weekday, startMinute: hhmmToMinutes(r.start), endMinute: hhmmToMinutes(r.end === '00:00' ? '24:00' : r.end) }));
    if (parsed.some((r) => r.startMinute === null || r.endMinute === null)) { setMsg({ ok: false, text: 'Revisa las horas.' }); return; }
    try {
      await staffSession.put(`/api/clinic/doctors/${doctor.id}/schedule`, { rules: parsed });
      setMsg({ ok: true, text: 'Horario guardado.' });
      onSaved();
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); }
  }

  return (
    <section className="stack">
      <h3>Horario semanal</h3>
      <p className="muted small">Bloques de atención en hora de la clínica. Las citas ya agendadas no se modifican al cambiar el horario.</p>
      {WEEKDAYS.map((name, i) => {
        const weekday = i + 1;
        const dayRules = rules.map((r, idx) => ({ r, idx })).filter(({ r }) => r.weekday === weekday);
        return (
          <div key={weekday} className="row" style={{ alignItems: 'flex-start' }}>
            <strong style={{ width: 90 }}>{name}</strong>
            <div className="stack" style={{ gap: 6, flex: 1 }}>
              {dayRules.length === 0 && <span className="muted small">Sin atención</span>}
              {dayRules.map(({ r, idx }) => (
                <div key={idx} className="row">
                  <input type="time" step={300} value={r.start} disabled={!canEdit} style={{ width: 'auto' }}
                    onChange={(e) => setRules(rules.map((x, j) => (j === idx ? { ...x, start: e.target.value } : x)))} />
                  <span>a</span>
                  <input type="time" step={300} value={r.end} disabled={!canEdit} style={{ width: 'auto' }}
                    onChange={(e) => setRules(rules.map((x, j) => (j === idx ? { ...x, end: e.target.value } : x)))} />
                  {canEdit && <button className="ghost" aria-label="Quitar bloque" onClick={() => setRules(rules.filter((_, j) => j !== idx))}>✕</button>}
                </div>
              ))}
            </div>
            {canEdit && <button className="ghost small" onClick={() => setRules([...rules, { weekday, start: '09:00', end: '14:00' }])}>+ Bloque</button>}
          </div>
        );
      })}
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
      {canEdit && <div><button className="primary" onClick={save}>Guardar horario</button></div>}
    </section>
  );
}

interface TimeOff { id: string; startsAt: string; endsAt: string; reason: string }

function TimeOffEditor({ doctor, tz, canEdit }: { doctor: Doctor; tz: string; canEdit: boolean }) {
  const [items, setItems] = useState<TimeOff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const today = todayIn(tz);
  const load = useCallback(() => staffSession.get<TimeOff[]>(`/api/clinic/doctors/${doctor.id}/time-off`).then(setItems).catch((e) => setError(errorMessage(e))), [doctor.id]);
  useEffect(() => { void load(); }, [load]);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const allDay = f.get('allDay') === 'on';
    const fromDate = String(f.get('fromDate')); const toDate = String(f.get('toDate'));
    const startsAt = zonedToUtcIso(fromDate, allDay ? '00:00' : String(f.get('fromTime')), tz);
    const endsAt = allDay
      ? new Date(new Date(zonedToUtcIso(toDate, '00:00', tz)).getTime() + 86400_000).toISOString()
      : zonedToUtcIso(toDate, String(f.get('toTime')), tz);
    setError(null);
    try {
      await staffSession.post(`/api/clinic/doctors/${doctor.id}/time-off`, { startsAt, endsAt, reason: f.get('reason') });
      e.currentTarget?.reset();
      await load();
    } catch (err) { setError(errorMessage(err)); }
  }

  async function remove(id: string) {
    setError(null);
    try { await staffSession.del(`/api/clinic/doctors/${doctor.id}/time-off/${id}`); await load(); } catch (err) { setError(errorMessage(err)); }
  }

  return (
    <section className="stack">
      <h3>Bloqueos (vacaciones, congresos, juntas)</h3>
      {items.length === 0 && <p className="muted small">Sin bloqueos próximos.</p>}
      {items.map((t) => (
        <div key={t.id} className="row">
          <span className="small" style={{ flex: 1 }}>
            <span>{fmtDate(t.startsAt, tz, { weekday: 'short' })}</span> {fmtTime(t.startsAt, tz)} → <span>{fmtDate(t.endsAt, tz, { weekday: 'short' })}</span> {fmtTime(t.endsAt, tz)} · {t.reason}
          </span>
          {canEdit && <button className="ghost danger" onClick={() => remove(t.id)}>Quitar</button>}
        </div>
      ))}
      {canEdit && (
        <form className="stack" onSubmit={add}>
          <div className="row">
            <label>Desde<input type="date" name="fromDate" required defaultValue={today} min={today} /></label>
            <label>Hora<input type="time" name="fromTime" step={300} defaultValue="09:00" /></label>
            <label>Hasta<input type="date" name="toDate" required defaultValue={today} min={today} /></label>
            <label>Hora<input type="time" name="toTime" step={300} defaultValue="14:00" /></label>
          </div>
          <label className="check"><input type="checkbox" name="allDay" />Días completos (ignora las horas)</label>
          <label>Motivo<input name="reason" required minLength={2} maxLength={200} placeholder="Vacaciones" /></label>
          {error && <div className="alert error">{error}</div>}
          <div><button>Agregar bloqueo</button></div>
        </form>
      )}
    </section>
  );
}
