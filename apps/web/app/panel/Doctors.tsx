'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { StaffSessionData, errorMessage, staffSession } from '@/lib/api';
import { WEEKDAYS, fmtDate, fmtTime, hhmmToMinutes, minutesToHHMM, todayIn, zonedToUtcIso } from '@/lib/format';
import type { Doctor, Location, Rule, Service } from './shared';

interface Member { id: string; role: string; active: boolean; user: { name: string; email: string }; doctor: { id: string } | null }

export function Doctors({ session }: { session: StaffSessionData }) {
  const role = session.membership.role;
  const isAdmin = role === 'OWNER' || role === 'ADMIN';
  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [editing, setEditing] = useState<Doctor | 'new' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [d, s, l] = await Promise.all([
        staffSession.get<Doctor[]>('/api/clinic/doctors'),
        staffSession.get<Service[]>('/api/clinic/services'),
        staffSession.get<Location[]>('/api/clinic/locations'),
      ]);
      setDoctors(d); setServices(s); setLocations(l);
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
        <DoctorForm doctor={editing === 'new' ? null : editing} services={services} members={members} canPhoto
          onDone={async () => { setEditing(null); await reload(); }} />
      )}
      {doctors && visible.length === 0 && <p className="muted">{role === 'DOCTOR' ? 'Tu usuario no está vinculado a un perfil de médico.' : 'Aún no hay médicos.'}</p>}
      <div className="grid">
        {visible.map((d) => (
          <div key={d.id} className="card stack" style={{ opacity: d.active ? 1 : 0.6 }}>
            <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              {d.photoUrl && <img src={d.photoUrl} alt="" width={56} height={56} style={{ borderRadius: 12, objectFit: 'cover', flexShrink: 0 }} />}
              <div>
              <h3 style={{ margin: 0 }}>{d.displayName} {!d.active && <span className="badge">Inactivo</span>}</h3>
              <div className="muted small">{d.specialty}{d.licenseNumber ? ` · Céd. ${d.licenseNumber}` : ''}</div>
              {d.inCatalog === false && <div className="small" style={{ color: 'var(--warn)' }}>Especialidad fuera del catálogo: no aparece al buscar por especialidad en el directorio.</div>}
              {d.membership && <div className="muted small">Usuario: {d.membership.user.email}</div>}
              </div>
            </div>
            <div className="small">
              {services.filter((s) => d.serviceIds.includes(s.id)).map((s) => s.name).join(', ') || <span className="muted">Sin servicios</span>}
            </div>
            <div className="small muted">{summarizeRules(d.rules, locations)}</div>
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
          {!isAdmin && current.id === session.membership.doctorId && <PhotoUploader doctor={current} onDone={reload} />}
          <ScheduleEditor doctor={current} locations={locations} canEdit={isAdmin || current.id === session.membership.doctorId} onSaved={reload} />
          <TimeOffEditor doctor={current} tz={session.clinic.timezone} canEdit={role !== 'DOCTOR' || current.id === session.membership.doctorId} />
        </div>
      )}
    </div>
  );
}

function summarizeRules(rules: Rule[], locations: Location[]): string {
  if (!rules.length) return 'Sin horario configurado';
  const many = locations.length > 1;
  const place = (r: Rule) => (many ? ` (${locations.find((l) => l.id === r.locationId)?.name ?? ''})` : '');
  const days = [...new Set(rules.map((r) => r.weekday))].sort();
  return days.map((w) => `${WEEKDAYS[w - 1].slice(0, 3)} ${rules.filter((r) => r.weekday === w).map((r) => `${minutesToHHMM(r.startMinute)}–${minutesToHHMM(r.endMinute)}${place(r)}`).join(', ')}`).join(' · ');
}

const lines = (v: FormDataEntryValue | null) => String(v ?? '').split('\n').map((x) => x.trim()).filter(Boolean);

/** Reduce la foto en el navegador (máx. 600 px, JPEG) para que pese poco y se vea igual en todos lados. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))), 'image/jpeg', 0.85));
}

function PhotoUploader({ doctor, onDone }: { doctor: Doctor; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState(doctor.photoUrl ?? null);
  async function upload(file: File) {
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.append('photo', await shrink(file), 'foto.jpg');
      const res = await fetch(`/api/clinic/doctors/${doctor.id}/photo`, {
        method: 'POST', body: form, credentials: 'same-origin', headers: { authorization: `Bearer ${staffSession.token}` },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'No se pudo subir la foto');
      setUrl(body.photoUrl);
      onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function remove() {
    setError(null);
    try { await staffSession.del(`/api/clinic/doctors/${doctor.id}/photo`); setUrl(null); onDone(); } catch (e) { setError(errorMessage(e)); }
  }
  return (
    <div className="row">
      {url ? <img src={url} alt="" width={72} height={72} style={{ borderRadius: 12, objectFit: 'cover' }} /> : <span className="small muted">Sin foto</span>}
      <label className="btn" style={{ fontWeight: 500 }}>{busy ? 'Subiendo…' : url ? 'Cambiar foto' : 'Subir foto'}
        <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
      </label>
      {url && <button type="button" className="ghost" onClick={remove}>Quitar</button>}
      {error && <span className="small" style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
}

function DoctorForm({ doctor, services, members, onDone, canPhoto }: { doctor: Doctor | null; services: Service[]; members: Member[]; onDone: () => void; canPhoto?: boolean }) {
  const [serviceIds, setServiceIds] = useState<string[]>(doctor?.serviceIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const doctorMembers = members.filter((m) => m.role !== 'RECEPTION' && m.active && (!m.doctor || m.doctor.id === doctor?.id));

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      displayName: f.get('displayName'), specialty: f.get('specialty'), licenseNumber: f.get('licenseNumber'),
      bio: f.get('bio'), serviceIds, membershipId: (f.get('membershipId') as string) || null,
      education: lines(f.get('education')), certifications: lines(f.get('certifications')), languages: lines(f.get('languages')),
      conditions: lines(f.get('conditions')), insurers: lines(f.get('insurers')),
    };
    if (doctor) { body.active = f.get('active') === 'on'; body.slug = String(f.get('slug') ?? '').trim(); }
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
        <label>Especialidad<input name="specialty" required minLength={2} maxLength={120} defaultValue={doctor?.specialty} list="catalogo-especialidades" autoComplete="off" />
          <CatalogList id="catalogo-especialidades" kind="specialties" />
        </label>
        <label>Cédula profesional<input name="licenseNumber" maxLength={30} defaultValue={doctor?.licenseNumber ?? ''} /></label>
        {doctor && (
          <label>Dirección de su página (/c/…/<em>esto</em>)
            <input name="slug" required minLength={2} maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" defaultValue={doctor.slug} autoCapitalize="none" />
          </label>
        )}
        <label>Usuario vinculado (quien atiende con este perfil)
          <select name="membershipId" defaultValue={doctor?.membership?.id ?? ''}>
            <option value="">Sin usuario</option>
            {doctorMembers.map((m) => <option key={m.id} value={m.id}>{m.user.name} · {m.user.email}</option>)}
          </select>
        </label>
      </div>
      {doctor && canPhoto && <PhotoUploader doctor={doctor} onDone={() => undefined} />}
      <label>Presentación (se muestra a pacientes)<textarea name="bio" maxLength={1000} defaultValue={doctor?.bio ?? ''} /></label>
      <p className="small muted">Perfil profesional: un elemento por renglón. Se muestra en la página de reservas.</p>
      <div className="grid">
        <label>Formación<textarea name="education" defaultValue={(doctor?.education ?? []).join('\n')} placeholder={'Médico Cirujano, UNAM\nEspecialidad en Cardiología, IMSS'} /></label>
        <label>Certificaciones de consejo<textarea name="certifications" defaultValue={(doctor?.certifications ?? []).join('\n')} placeholder="Consejo Mexicano de Cardiología" /></label>
        <label>Idiomas<textarea name="languages" defaultValue={(doctor?.languages ?? []).join('\n')} placeholder={'Español\nInglés'} /></label>
        <label>Padecimientos que atiende (uno por renglón; los del catálogo mejoran la búsqueda)<textarea name="conditions" defaultValue={(doctor?.conditions ?? []).join('\n')} placeholder={'Hipertensión\nArritmias'} /></label>
        <label>Aseguradoras aceptadas<textarea name="insurers" defaultValue={(doctor?.insurers ?? []).join('\n')} placeholder={'GNP\nAXA'} /></label>
      </div>
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

interface EditableRule { weekday: number; start: string; end: string; locationId: string; roomId: string }

function ScheduleEditor({ doctor, locations, canEdit, onSaved }: { doctor: Doctor; locations: Location[]; canEdit: boolean; onSaved: () => void }) {
  const active = locations.filter((l) => l.active);
  const toEditable = (rules: Rule[]) => rules.map((r) => ({
    weekday: r.weekday, start: minutesToHHMM(r.startMinute), end: minutesToHHMM(r.endMinute),
    locationId: r.locationId ?? active[0]?.id ?? '', roomId: r.roomId ?? '',
  }));
  const [rules, setRules] = useState<EditableRule[]>(toEditable(doctor.rules));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setRules(toEditable(doctor.rules)); setMsg(null); }, [doctor]);

  async function save() {
    setMsg(null);
    const parsed = rules.map((r) => ({
      weekday: r.weekday, startMinute: hhmmToMinutes(r.start), endMinute: hhmmToMinutes(r.end === '00:00' ? '24:00' : r.end),
      ...(r.locationId ? { locationId: r.locationId } : {}), roomId: r.roomId || null,
    }));
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
      <p className="muted small">Bloques de atención en hora de la clínica, cada uno en una sede y, opcionalmente, un consultorio. Las citas ya agendadas no se modifican al cambiar el horario.</p>
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
                  {active.length > 1 && (
                    <select value={r.locationId} disabled={!canEdit} style={{ width: 'auto' }} aria-label="Sede"
                      onChange={(e) => setRules(rules.map((x, j) => (j === idx ? { ...x, locationId: e.target.value, roomId: '' } : x)))}>
                      {active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  )}
                  {(active.find((l) => l.id === r.locationId)?.rooms.filter((x) => x.active).length ?? 0) > 0 && (
                    <select value={r.roomId} disabled={!canEdit} style={{ width: 'auto' }} aria-label="Consultorio"
                      onChange={(e) => setRules(rules.map((x, j) => (j === idx ? { ...x, roomId: e.target.value } : x)))}>
                      <option value="">Sin consultorio</option>
                      {active.find((l) => l.id === r.locationId)!.rooms.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  )}
                  {canEdit && <button className="ghost" aria-label="Quitar bloque" onClick={() => setRules(rules.filter((_, j) => j !== idx))}>✕</button>}
                </div>
              ))}
            </div>
            {canEdit && <button className="ghost small" onClick={() => setRules([...rules, { weekday, start: '09:00', end: '14:00', locationId: active[0]?.id ?? '', roomId: '' }])}>+ Bloque</button>}
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

let catalogCache: Promise<{ specialties: { name: string }[]; conditions: { name: string }[] }> | null = null;

/** Sugerencias del catálogo del directorio para escribir la especialidad como la buscan los pacientes. */
function CatalogList({ id, kind }: { id: string; kind: 'specialties' | 'conditions' }) {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    catalogCache ??= fetch('/api/public/directory/catalog').then((r) => (r.ok ? r.json() : { specialties: [], conditions: [] }));
    catalogCache.then((c) => setNames(c[kind].map((x) => x.name))).catch(() => undefined);
  }, [kind]);
  return <datalist id={id}>{names.map((n) => <option key={n} value={n} />)}</datalist>;
}
