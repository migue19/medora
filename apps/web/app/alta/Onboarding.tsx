'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { ApiError, Session, errorMessage } from '@/lib/api';
import { WEEKDAYS, hhmmToMinutes, minutesToHHMM } from '@/lib/format';
import { takeLinkToken } from '@/lib/link-token';

const anon = new Session('patient');

// ------------------------------------------------------------------ tipos

interface Block { weekday: number; startMinute: number; endMinute: number }
interface Location {
  key: string; name: string; address: string; neighborhood: string; city: string; postalCode: string; phone: string; mapUrl: string;
  hours: Block[]; rooms: string[];
}
interface Member { key: string; name: string; email: string; role: 'OWNER' | 'ADMIN' | 'RECEPTION' | 'DOCTOR'; doctorKey: string }
interface Doctor {
  key: string; displayName: string; specialty: string; licenseNumber: string; locationKeys: string[]; bio: string;
  education: string[]; certifications: string[]; languages: string[]; conditions: string[]; insurers: string[];
}
interface Service {
  key: string; name: string; durationMinutes: number; priceCents: number; visitType: 'ANY' | 'FIRST' | 'FOLLOW_UP'; telemedicine: boolean;
  doctorKeys: string[]; prices: { doctorKey: string; locationKey: string; priceCents: number }[];
}
interface Schedule extends Block { doctorKey: string; locationKey: string; room: string }
interface Data {
  clinic: { name: string; slug: string; phone: string; email: string; website: string; instagram: string; googleMaps: string };
  locations: Location[]; team: Member[]; doctors: Doctor[]; services: Service[]; schedules: Schedule[];
  timeOff: { doctorKey: string; from: string; to: string; reason: string }[];
  rules: { bookingEnabled: boolean; minNoticeMinutes: number; horizonDays: number; patientCancelMinMinutes: number };
  communication: { reminderOffsets: number[]; reviewsEnabled: boolean; whatsapp: boolean; moderator: string };
  privacy: { noticeUrl: string; noticeText: string; officerName: string; officerEmail: string; approved: boolean; directory: boolean };
  contacts: { responsibleName: string; responsiblePhone: string; responsibleEmail: string; receptionName: string; receptionPhone: string };
}
interface Issue { section: string; message: string; required: boolean }
interface Loaded { status: 'DRAFT' | 'SUBMITTED' | 'IMPORTED'; data: Data; issues: Issue[]; photos: Record<string, number> }

const SECTIONS = [
  { id: 'clinica', label: '1. Clínica' }, { id: 'sedes', label: '2. Sedes' }, { id: 'equipo', label: '3. Equipo' },
  { id: 'medicos', label: '4. Médicos' }, { id: 'servicios', label: '5. Servicios' }, { id: 'horarios', label: '6. Horarios' },
  { id: 'reglas', label: '7. Reservas' }, { id: 'comunicacion', label: '8. Pacientes' }, { id: 'privacidad', label: '9. Privacidad' },
  { id: 'contactos', label: '10. Contacto y envío' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const ROLE: Record<Member['role'], string> = { OWNER: 'Propietario', ADMIN: 'Administración', RECEPTION: 'Recepción', DOCTOR: 'Médico' };
const VISIT: Record<Service['visitType'], string> = { ANY: 'Cualquiera', FIRST: 'Sólo primera vez', FOLLOW_UP: 'Sólo subsecuente' };
const REMINDERS = [{ m: 2880, l: '48 h' }, { m: 1440, l: '24 h' }, { m: 240, l: '4 h' }, { m: 120, l: '2 h' }, { m: 60, l: '1 h' }];
const newKey = () => Math.random().toString(36).slice(2, 10);
const lines = (v: string[]) => v.join('\n');
const toLines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const time = (m: number) => minutesToHHMM(m === 1440 ? 0 : m);
const fromTime = (v: string, end = false) => { const m = hhmmToMinutes(v) ?? 0; return end && m === 0 ? 1440 : m; };
const money = (c: number) => (c / 100).toFixed(2);
const cents = (v: string) => Math.max(0, Math.round(Number(v.replace(/[^0-9.]/g, '')) * 100) || 0);
const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Reduce la foto en el navegador (máx. 600 px, JPEG) antes de subirla. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))), 'image/jpeg', 0.85));
}

// ------------------------------------------------------------------ página

export function Onboarding() {
  const [token, setToken] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<Loaded | null>(null);
  const [section, setSection] = useState<SectionId>('clinica');
  const [saving, setSaving] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const started = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Data | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Se conserva en la pestaña para que recargar la página no la deje sin acceso.
    let t = takeLinkToken();
    try {
      if (t) sessionStorage.setItem('medora-alta', t);
      else t = sessionStorage.getItem('medora-alta');
    } catch { /* almacenamiento bloqueado: basta con el enlace */ }
    if (!t) { setLoadError('El enlace está incompleto. Ábrelo directamente desde el mensaje que te enviamos.'); return; }
    setToken(t);
    anon.request<Loaded>('POST', '/api/public/onboarding/load', { token: t }, false).then(setState).catch((e) => setLoadError(errorMessage(e)));
  }, []);

  const save = useCallback(async () => {
    if (!token || !latest.current) return;
    setSaving('saving');
    try {
      const r = await anon.request<{ issues: Issue[]; status: Loaded['status'] }>('PUT', '/api/public/onboarding/save', { token, data: latest.current }, false);
      setState((s) => (s ? { ...s, issues: r.issues, status: r.status } : s));
      setSaving('saved'); setSaveError(null);
    } catch (e) { setSaving('error'); setSaveError(errorMessage(e)); }
  }, [token]);

  // Guardado automático un momento después de dejar de escribir; también al salir de la página.
  const change = useCallback((update: (d: Data) => Data) => {
    setState((s) => {
      if (!s) return s;
      const data = update(s.data);
      latest.current = data;
      return { ...s, data };
    });
    setSaving('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, 1200);
  }, [save]);

  useEffect(() => {
    const flush = () => { if (timer.current) { clearTimeout(timer.current); void save(); } };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [save]);

  const required = useMemo(() => (state?.issues ?? []).filter((i) => i.required), [state]);
  const count = (id: SectionId) => required.filter((i) => i.section === id).length;

  if (loadError) return (<><Header /><main className="container narrow section"><div className="alert error" role="alert">{loadError}</div></main></>);
  if (!state) return (<><Header /><main className="container section"><p className="muted">Cargando…</p></main></>);
  const d = state.data;
  const locked = state.status === 'IMPORTED';
  const props = { d, change, locked, issues: state.issues.filter((i) => i.section === section) };

  return (
    <>
      <Header><span className="small muted" aria-live="polite">{
        saving === 'saving' ? 'Guardando…' : saving === 'pending' ? 'Cambios sin guardar…' : saving === 'saved' ? 'Guardado' : saving === 'error' ? 'No se pudo guardar' : 'Se guarda solo'
      }</span></Header>
      <main className="container section stack">
        <div>
          <h1>Alta de {d.clinic.name || 'tu clínica'} en Medora</h1>
          <p className="muted">Llénalo a tu ritmo: se guarda solo y puedes volver con el mismo enlace. Lo marcado con <strong>*</strong> es indispensable; lo demás puede llegar después.</p>
        </div>
        {saveError && <div className="alert error" role="alert">{saveError}</div>}
        {state.status === 'SUBMITTED' && <div className="alert ok">Ya lo enviaste. Lo revisamos y te avisamos; aún puedes corregir y volver a enviar.</div>}
        {locked && <div className="alert ok">Tu clínica ya está en Medora. Los cambios ahora se hacen desde el panel.</div>}
        <nav className="tabs" aria-label="Secciones del alta">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={section === s.id} onClick={() => { setSection(s.id); window.scrollTo({ top: 0 }); }}>
              {s.label}{count(s.id) ? <span className="badge NO_SHOW" style={{ marginLeft: 6 }}>{count(s.id)}</span> : null}
            </button>
          ))}
        </nav>
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="stack">
          {section === 'clinica' && <ClinicSection {...props} />}
          {section === 'sedes' && <LocationsSection {...props} />}
          {section === 'equipo' && <TeamSection {...props} />}
          {section === 'medicos' && <DoctorsSection {...props} token={token!} photos={state.photos} onPhoto={(k, v) => setState((s) => (s ? { ...s, photos: { ...s.photos, ...(v ? { [k]: v } : {}) } } : s))} onPhotoDeleted={(k) => setState((s) => { if (!s) return s; const photos = { ...s.photos }; delete photos[k]; return { ...s, photos }; })} />}
          {section === 'servicios' && <ServicesSection {...props} />}
          {section === 'horarios' && <ScheduleSection {...props} />}
          {section === 'reglas' && <RulesSection {...props} />}
          {section === 'comunicacion' && <CommunicationSection {...props} />}
          {section === 'privacidad' && <PrivacySection {...props} />}
          {section === 'contactos' && <ContactsSection {...props} allIssues={state.issues} status={state.status} token={token!}
            beforeSubmit={save} onSubmitted={() => setState((s) => (s ? { ...s, status: 'SUBMITTED' } : s))} goTo={(id) => { setSection(id); window.scrollTo({ top: 0 }); }} />}
        </fieldset>
        <div className="row">
          {SECTIONS.findIndex((s) => s.id === section) > 0 && <button type="button" onClick={() => { setSection(SECTIONS[SECTIONS.findIndex((s) => s.id === section) - 1].id); window.scrollTo({ top: 0 }); }}>← Anterior</button>}
          <span className="spacer" />
          {SECTIONS.findIndex((s) => s.id === section) < SECTIONS.length - 1 && <button type="button" className="primary" onClick={() => { setSection(SECTIONS[SECTIONS.findIndex((s) => s.id === section) + 1].id); window.scrollTo({ top: 0 }); }}>Siguiente →</button>}
        </div>
      </main>
    </>
  );
}

interface SectionProps { d: Data; change: (u: (d: Data) => Data) => void; locked: boolean; issues: Issue[] }

function Issues({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  const req = issues.filter((i) => i.required); const tips = issues.filter((i) => !i.required);
  return (
    <div className="stack" style={{ gap: 6 }}>
      {req.length > 0 && <div className="alert warn small" role="status"><strong>Falta:</strong><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{req.map((i, n) => <li key={n}>{i.message}</li>)}</ul></div>}
      {tips.length > 0 && <div className="small muted"><strong>Sugerencias:</strong> {tips.map((i) => i.message).join(' · ')}</div>}
    </div>
  );
}

/** Lista editable genérica: actualiza el elemento `i` de un arreglo. */
const at = <T,>(list: T[], i: number, patch: Partial<T>) => list.map((x, j) => (j === i ? { ...x, ...patch } : x));

function ClinicSection({ d, change, issues }: SectionProps) {
  const set = (patch: Partial<Data['clinic']>) => change((x) => ({ ...x, clinic: { ...x.clinic, ...patch } }));
  return (
    <div className="card stack">
      <h2>Datos de la clínica</h2>
      <Issues issues={issues} />
      <div className="grid">
        <label>Nombre comercial *<input value={d.clinic.name} maxLength={120} onChange={(e) => set({
          name: e.target.value,
          // El identificador sigue al nombre mientras no lo hayan cambiado a mano.
          ...(!d.clinic.slug || d.clinic.slug === slugify(d.clinic.name) ? { slug: slugify(e.target.value) } : {}),
        })} /></label>
        <label>Identificador para la dirección web *
          <input value={d.clinic.slug} maxLength={60} autoCapitalize="none" placeholder={slugify(d.clinic.name)}
            onChange={(e) => set({ slug: e.target.value.toLowerCase() })} onBlur={() => { if (!d.clinic.slug && d.clinic.name) set({ slug: slugify(d.clinic.name) }); }} />
        </label>
        <label>Teléfono principal *<input value={d.clinic.phone} inputMode="tel" maxLength={30} onChange={(e) => set({ phone: e.target.value })} /></label>
        <label>Correo de la clínica *<input type="email" value={d.clinic.email} maxLength={254} onChange={(e) => set({ email: e.target.value })} /></label>
      </div>
      <p className="small muted">Su página de reservas quedará en <strong>medora.nut.com.mx/c/{d.clinic.slug || slugify(d.clinic.name) || 'su-clinica'}</strong>. Sólo minúsculas, números y guiones.</p>
      <div className="grid">
        <label>Sitio web<input value={d.clinic.website} maxLength={300} placeholder="https://…" onChange={(e) => set({ website: e.target.value })} /></label>
        <label>Instagram<input value={d.clinic.instagram} maxLength={300} placeholder="@clinica" onChange={(e) => set({ instagram: e.target.value })} /></label>
        <label>Perfil de Google Maps<input value={d.clinic.googleMaps} maxLength={500} placeholder="https://maps.app.goo.gl/…" onChange={(e) => set({ googleMaps: e.target.value })} /></label>
      </div>
    </div>
  );
}

function BlocksEditor({ blocks, onChange, extra }: {
  blocks: Block[]; onChange: (b: Block[]) => void; extra?: (b: Block, i: number) => React.ReactNode;
}) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {WEEKDAYS.map((name, w) => {
        const day = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.weekday === w + 1);
        return (
          <div key={w} className="row" style={{ alignItems: 'flex-start' }}>
            <strong className="small" style={{ width: 84, paddingTop: 8 }}>{name}</strong>
            <div className="stack" style={{ gap: 6, flex: 1 }}>
              {day.length === 0 && <span className="small muted" style={{ paddingTop: 8 }}>Sin atención</span>}
              {day.map(({ b, i }) => (
                <div key={i} className="row">
                  <input type="time" step={300} aria-label={`${name} desde`} value={time(b.startMinute)} style={{ width: 'auto' }}
                    onChange={(e) => onChange(at(blocks, i, { startMinute: fromTime(e.target.value) }))} />
                  <span>a</span>
                  <input type="time" step={300} aria-label={`${name} hasta`} value={time(b.endMinute)} style={{ width: 'auto' }}
                    onChange={(e) => onChange(at(blocks, i, { endMinute: fromTime(e.target.value, true) }))} />
                  {extra?.(b, i)}
                  <button type="button" className="ghost" aria-label="Quitar bloque" onClick={() => onChange(blocks.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
            <button type="button" className="ghost small" onClick={() => onChange([...blocks, { weekday: w + 1, startMinute: 540, endMinute: 840 }])}>+ Bloque</button>
          </div>
        );
      })}
    </div>
  );
}

function LocationsSection({ d, change, issues }: SectionProps) {
  const set = (i: number, patch: Partial<Location>) => change((x) => ({ ...x, locations: at(x.locations, i, patch) }));
  const add = () => change((x) => ({ ...x, locations: [...x.locations, {
    key: newKey(), name: x.locations.length ? '' : 'Sede principal', address: '', neighborhood: '', city: '', postalCode: '', phone: '', mapUrl: '',
    hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1140 })), rooms: [],
  }] }));
  const remove = (i: number) => {
    const k = d.locations[i].key;
    if (!window.confirm(`¿Quitar ${d.locations[i].name || 'esta sede'}? También se quitan sus horarios.`)) return;
    change((x) => ({
      ...x, locations: x.locations.filter((_, j) => j !== i),
      doctors: x.doctors.map((o) => ({ ...o, locationKeys: o.locationKeys.filter((l) => l !== k) })),
      schedules: x.schedules.filter((s) => s.locationKey !== k),
    }));
  };
  return (
    <div className="stack">
      <Issues issues={issues} />
      {d.locations.map((l, i) => (
        <div key={l.key} className="card stack">
          <div className="row"><h2 style={{ margin: 0 }}>{l.name || `Sede ${i + 1}`}</h2><span className="spacer" />
            <button type="button" className="ghost danger" onClick={() => remove(i)}>Quitar sede</button></div>
          <div className="grid">
            <label>Nombre de la sede *<input value={l.name} maxLength={120} onChange={(e) => set(i, { name: e.target.value })} placeholder="Sede Centro" /></label>
            <label>Dirección (calle y número) *<input value={l.address} maxLength={240} onChange={(e) => set(i, { address: e.target.value })} /></label>
            <label>Colonia<input value={l.neighborhood} maxLength={80} onChange={(e) => set(i, { neighborhood: e.target.value })} /></label>
            <label>Ciudad<input value={l.city} maxLength={80} onChange={(e) => set(i, { city: e.target.value })} /></label>
            <label>Código postal<input value={l.postalCode} maxLength={10} inputMode="numeric" onChange={(e) => set(i, { postalCode: e.target.value })} /></label>
            <label>Teléfono de la sede<input value={l.phone} maxLength={30} inputMode="tel" onChange={(e) => set(i, { phone: e.target.value })} /></label>
            <label>Enlace de Google Maps<input value={l.mapUrl} maxLength={500} placeholder="https://maps.app.goo.gl/…" onChange={(e) => set(i, { mapUrl: e.target.value })} /></label>
          </div>
          <h3>Horario de atención de la sede *</h3>
          <BlocksEditor blocks={l.hours} onChange={(hours) => set(i, { hours })} />
          <label>Consultorios (uno por renglón; déjalo vacío si no comparten espacios)
            <textarea value={lines(l.rooms)} onChange={(e) => set(i, { rooms: e.target.value.split('\n').map((x) => x.trimStart()) })}
              onBlur={() => set(i, { rooms: toLines(lines(l.rooms)) })} placeholder={'Consultorio 1\nConsultorio 2'} />
          </label>
        </div>
      ))}
      <div><button type="button" className="primary" onClick={add}>+ Agregar sede</button></div>
    </div>
  );
}

function TeamSection({ d, change, issues }: SectionProps) {
  const set = (i: number, patch: Partial<Member>) => change((x) => ({ ...x, team: at(x.team, i, patch) }));
  return (
    <div className="card stack">
      <h2>Equipo con acceso al panel</h2>
      <p className="small muted">Cada persona recibirá una invitación por correo y elegirá su propia contraseña. Indica un solo propietario.</p>
      <Issues issues={issues} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nombre *</th><th>Correo *</th><th>Rol *</th><th>Su perfil de médico</th><th /></tr></thead>
          <tbody>
            {d.team.map((t, i) => (
              <tr key={t.key}>
                <td><input aria-label="Nombre" value={t.name} maxLength={120} onChange={(e) => set(i, { name: e.target.value })} /></td>
                <td><input aria-label="Correo" type="email" value={t.email} maxLength={254} onChange={(e) => set(i, { email: e.target.value })} /></td>
                <td><select aria-label="Rol" value={t.role} onChange={(e) => set(i, { role: e.target.value as Member['role'], doctorKey: e.target.value === 'DOCTOR' ? t.doctorKey : '' })}>
                  {Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></td>
                <td>{t.role === 'DOCTOR' ? (
                  <select aria-label="Perfil de médico" value={t.doctorKey} onChange={(e) => set(i, { doctorKey: e.target.value })}>
                    <option value="">Elegir…</option>
                    {d.doctors.map((o) => <option key={o.key} value={o.key}>{o.displayName || 'Sin nombre'}</option>)}
                  </select>
                ) : <span className="small muted">—</span>}</td>
                <td><button type="button" className="ghost" aria-label="Quitar" onClick={() => change((x) => ({ ...x, team: x.team.filter((_, j) => j !== i) }))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div><button type="button" className="primary" onClick={() => change((x) => ({ ...x, team: [...x.team, { key: newKey(), name: '', email: '', role: x.team.some((m) => m.role === 'OWNER') ? 'RECEPTION' : 'OWNER', doctorKey: '' }] }))}>+ Agregar persona</button></div>
      <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
        <li><strong>Propietario</strong>: todo, incluido dar de alta administradores.</li>
        <li><strong>Administración</strong>: sedes, servicios, médicos, precios, equipo y opiniones.</li>
        <li><strong>Recepción</strong>: agenda, pacientes, citas por teléfono y lista de espera.</li>
        <li><strong>Médico</strong>: sólo su agenda, sus pacientes y sus opiniones.</li>
      </ul>
    </div>
  );
}

function DoctorPhoto({ token, doctor, version, onUploaded, onDeleted }: {
  token: string; doctor: Doctor; version?: number; onUploaded: (v: number) => void; onDeleted: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!version) { setUrl(null); return; }
    let revoke: string | null = null;
    fetch('/api/public/onboarding/photo/view', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, doctorKey: doctor.key }) })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) { revoke = URL.createObjectURL(b); setUrl(revoke); } }).catch(() => undefined);
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [token, doctor.key, version]);
  async function upload(file: File) {
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.append('token', token); form.append('doctorKey', doctor.key); form.append('photo', await shrink(file), 'foto.jpg');
      const res = await fetch('/api/public/onboarding/photo', { method: 'POST', body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? 'No se pudo subir la foto');
      onUploaded(body.version);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <div className="row">
      {url ? <img src={url} alt={`Foto de ${doctor.displayName}`} width={72} height={72} style={{ borderRadius: 12, objectFit: 'cover' }} /> : <span className="small muted">Sin foto</span>}
      <label className="btn" style={{ fontWeight: 500 }}>{busy ? 'Subiendo…' : url ? 'Cambiar foto' : 'Subir foto'}
        <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
      </label>
      {url && <button type="button" className="ghost" onClick={async () => {
        await anon.request('POST', '/api/public/onboarding/photo/delete', { token, doctorKey: doctor.key }, false).catch(() => undefined); onDeleted();
      }}>Quitar</button>}
      {error && <span className="small" style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
}

function DoctorsSection({ d, change, issues, token, photos, onPhoto, onPhotoDeleted }: SectionProps & {
  token: string; photos: Record<string, number>; onPhoto: (k: string, v: number) => void; onPhotoDeleted: (k: string) => void;
}) {
  const set = (i: number, patch: Partial<Doctor>) => change((x) => ({ ...x, doctors: at(x.doctors, i, patch) }));
  const listField = (i: number, field: 'education' | 'certifications' | 'languages' | 'conditions' | 'insurers', label: string, ph: string) => (
    <label>{label}<textarea value={lines(d.doctors[i][field])} placeholder={ph}
      onChange={(e) => set(i, { [field]: e.target.value.split('\n').map((x) => x.trimStart()) } as Partial<Doctor>)}
      onBlur={() => set(i, { [field]: toLines(lines(d.doctors[i][field])) } as Partial<Doctor>)} /></label>
  );
  const remove = (i: number) => {
    const k = d.doctors[i].key;
    if (!window.confirm(`¿Quitar a ${d.doctors[i].displayName || 'este médico'}? También se quita de servicios y horarios.`)) return;
    change((x) => ({
      ...x, doctors: x.doctors.filter((_, j) => j !== i),
      services: x.services.map((s) => ({ ...s, doctorKeys: s.doctorKeys.filter((o) => o !== k), prices: s.prices.filter((p) => p.doctorKey !== k) })),
      schedules: x.schedules.filter((s) => s.doctorKey !== k), timeOff: x.timeOff.filter((t) => t.doctorKey !== k),
      team: x.team.map((t) => (t.doctorKey === k ? { ...t, doctorKey: '' } : t)),
    }));
  };
  return (
    <div className="stack">
      <Issues issues={issues} />
      {d.doctors.map((o, i) => (
        <div key={o.key} className="card stack">
          <div className="row"><h2 style={{ margin: 0 }}>{o.displayName || `Médico ${i + 1}`}</h2><span className="spacer" />
            <button type="button" className="ghost danger" onClick={() => remove(i)}>Quitar</button></div>
          <DoctorPhoto token={token} doctor={o} version={photos[o.key]} onUploaded={(v) => onPhoto(o.key, v)} onDeleted={() => onPhotoDeleted(o.key)} />
          <div className="grid">
            <label>Nombre como quiere aparecer *<input value={o.displayName} maxLength={120} placeholder="Dra. Ana López" onChange={(e) => set(i, { displayName: e.target.value })} /></label>
            <label>Especialidad *<input value={o.specialty} maxLength={120} placeholder="Cardiología" onChange={(e) => set(i, { specialty: e.target.value })} /></label>
            <label>Cédula profesional<input value={o.licenseNumber} maxLength={30} onChange={(e) => set(i, { licenseNumber: e.target.value })} /></label>
          </div>
          <fieldset className="row" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small" style={{ fontWeight: 600 }}>Sedes donde atiende *</legend>
            {d.locations.length === 0 && <span className="small muted">Primero agrega las sedes.</span>}
            {d.locations.map((l) => (
              <label key={l.key} className="check"><input type="checkbox" checked={o.locationKeys.includes(l.key)}
                onChange={(e) => set(i, { locationKeys: e.target.checked ? [...o.locationKeys, l.key] : o.locationKeys.filter((x) => x !== l.key) })} />{l.name || 'Sede sin nombre'}</label>
            ))}
          </fieldset>
          <label>Presentación breve (2 a 4 líneas)<textarea value={o.bio} maxLength={1000} onChange={(e) => set(i, { bio: e.target.value })} /></label>
          <p className="small muted">Una cosa por renglón:</p>
          <div className="grid">
            {listField(i, 'education', 'Formación', 'Médico Cirujano, UNAM\nEspecialidad en Cardiología, IMSS')}
            {listField(i, 'certifications', 'Certificaciones de consejo', 'Consejo Mexicano de Cardiología')}
            {listField(i, 'languages', 'Idiomas', 'Español\nInglés')}
            {listField(i, 'conditions', 'Padecimientos que atiende', 'Hipertensión\nArritmias')}
            {listField(i, 'insurers', 'Aseguradoras que acepta', 'GNP\nAXA')}
          </div>
        </div>
      ))}
      <div><button type="button" className="primary" onClick={() => change((x) => ({ ...x, doctors: [...x.doctors, {
        key: newKey(), displayName: '', specialty: '', licenseNumber: '', locationKeys: x.locations.length === 1 ? [x.locations[0].key] : [], bio: '',
        education: [], certifications: [], languages: [], conditions: [], insurers: [],
      }] }))}>+ Agregar médico</button></div>
    </div>
  );
}

function ServicesSection({ d, change, issues }: SectionProps) {
  const set = (i: number, patch: Partial<Service>) => change((x) => ({ ...x, services: at(x.services, i, patch) }));
  return (
    <div className="stack">
      <Issues issues={issues} />
      {d.services.map((s, i) => (
        <div key={s.key} className="card stack">
          <div className="row"><h2 style={{ margin: 0 }}>{s.name || `Servicio ${i + 1}`}</h2><span className="spacer" />
            <button type="button" className="ghost danger" onClick={() => change((x) => ({ ...x, services: x.services.filter((_, j) => j !== i) }))}>Quitar</button></div>
          <div className="grid">
            <label>Nombre *<input value={s.name} maxLength={120} placeholder="Consulta de primera vez" onChange={(e) => set(i, { name: e.target.value })} /></label>
            <label>Duración (minutos) *<input type="number" min={5} max={480} step={5} value={s.durationMinutes} onChange={(e) => set(i, { durationMinutes: Number(e.target.value) || 0 })} /></label>
            <label>Precio base (MXN) *<input inputMode="decimal" defaultValue={money(s.priceCents)} onBlur={(e) => set(i, { priceCents: cents(e.target.value) })} /></label>
            <label>Para<select value={s.visitType} onChange={(e) => set(i, { visitType: e.target.value as Service['visitType'] })}>
              {Object.entries(VISIT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          </div>
          <label className="check"><input type="checkbox" checked={s.telemedicine} onChange={(e) => set(i, { telemedicine: e.target.checked })} />También por videoconsulta</label>
          <fieldset className="row" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small" style={{ fontWeight: 600 }}>Médicos que lo ofrecen *</legend>
            {d.doctors.length === 0 && <span className="small muted">Primero agrega los médicos.</span>}
            {d.doctors.map((o) => (
              <label key={o.key} className="check"><input type="checkbox" checked={s.doctorKeys.includes(o.key)}
                onChange={(e) => set(i, { doctorKeys: e.target.checked ? [...s.doctorKeys, o.key] : s.doctorKeys.filter((x) => x !== o.key) })} />{o.displayName || 'Sin nombre'}</label>
            ))}
          </fieldset>
          <details open={s.prices.length > 0}>
            <summary className="small">Precios distintos por sede o médico ({s.prices.length})</summary>
            <div className="stack" style={{ marginTop: 8 }}>
              {s.prices.map((p, j) => (
                <div key={j} className="row">
                  <select aria-label="Sede" value={p.locationKey} style={{ width: 'auto' }} onChange={(e) => set(i, { prices: at(s.prices, j, { locationKey: e.target.value }) })}>
                    <option value="">Todas las sedes</option>{d.locations.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}</select>
                  <select aria-label="Médico" value={p.doctorKey} style={{ width: 'auto' }} onChange={(e) => set(i, { prices: at(s.prices, j, { doctorKey: e.target.value }) })}>
                    <option value="">Todos los médicos</option>{d.doctors.filter((o) => s.doctorKeys.includes(o.key)).map((o) => <option key={o.key} value={o.key}>{o.displayName}</option>)}</select>
                  <input aria-label="Precio" inputMode="decimal" defaultValue={money(p.priceCents)} style={{ width: 110 }} onBlur={(e) => set(i, { prices: at(s.prices, j, { priceCents: cents(e.target.value) }) })} />
                  <button type="button" className="ghost" aria-label="Quitar precio" onClick={() => set(i, { prices: s.prices.filter((_, k) => k !== j) })}>✕</button>
                </div>
              ))}
              <div><button type="button" className="small" onClick={() => set(i, { prices: [...s.prices, { doctorKey: '', locationKey: d.locations[0]?.key ?? '', priceCents: s.priceCents }] })}>+ Precio especial</button></div>
            </div>
          </details>
        </div>
      ))}
      <div><button type="button" className="primary" onClick={() => change((x) => ({ ...x, services: [...x.services, {
        key: newKey(), name: '', durationMinutes: 30, priceCents: 0, visitType: 'ANY', telemedicine: false, doctorKeys: x.doctors.length === 1 ? [x.doctors[0].key] : [], prices: [],
      }] }))}>+ Agregar servicio</button></div>
    </div>
  );
}

function ScheduleSection({ d, change, issues }: SectionProps) {
  const [doctorKey, setDoctorKey] = useState(d.doctors[0]?.key ?? '');
  const doctor = d.doctors.find((o) => o.key === doctorKey);
  const mine = d.schedules.map((s, i) => ({ s, i })).filter(({ s }) => s.doctorKey === doctorKey);
  const blocks = mine.map(({ s }) => s);
  const myLocations = d.locations.filter((l) => doctor?.locationKeys.includes(l.key));
  // Los bloques existentes conservan su sede y consultorio; los nuevos toman la primera sede del médico.
  const update = (next: Block[]) => change((x) => ({
    ...x, schedules: [...x.schedules.filter((s) => s.doctorKey !== doctorKey), ...next.map((b) => ({
      locationKey: myLocations[0]?.key ?? '', room: '', ...b, doctorKey,
    }))],
  }));
  const setBlock = (j: number, patch: Partial<Schedule>) => change((x) => {
    const idx = x.schedules.map((s, i) => ({ s, i })).filter(({ s }) => s.doctorKey === doctorKey).at(j)?.i;
    return idx === undefined ? x : { ...x, schedules: at(x.schedules, idx, patch) };
  });
  return (
    <div className="stack">
      <Issues issues={issues} />
      {d.doctors.length === 0 ? <p className="muted">Primero agrega los médicos.</p> : (
        <div className="card stack">
          <label>Médico<select value={doctorKey} onChange={(e) => setDoctorKey(e.target.value)} style={{ width: 'auto' }}>
            {d.doctors.map((o) => <option key={o.key} value={o.key}>{o.displayName || 'Sin nombre'} ({d.schedules.filter((s) => s.doctorKey === o.key).length} bloques)</option>)}
          </select></label>
          <p className="small muted">Bloques de atención de cada día, con su sede y consultorio. Las citas se ofrecen dentro de estos bloques.</p>
          {doctor && <BlocksEditor blocks={blocks} onChange={update} extra={(_, j) => {
            const s = mine.at(j)?.s; if (!s) return null;
            const loc = d.locations.find((l) => l.key === s.locationKey);
            return (<>
              <select aria-label="Sede" value={s.locationKey} style={{ width: 'auto' }} onChange={(e) => setBlock(j, { locationKey: e.target.value, room: '' })}>
                <option value="">Sede…</option>{myLocations.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}</select>
              {loc && loc.rooms.length > 0 && (
                <select aria-label="Consultorio" value={s.room} style={{ width: 'auto' }} onChange={(e) => setBlock(j, { room: e.target.value })}>
                  <option value="">Sin consultorio</option>{loc.rooms.map((r) => <option key={r} value={r}>{r}</option>)}</select>
              )}
            </>);
          }} />}
        </div>
      )}
      <div className="card stack">
        <h2>Días bloqueados próximos</h2>
        <p className="small muted">Vacaciones, congresos o cursos de las próximas semanas: ese médico no tendrá citas en línea esos días.</p>
        {d.timeOff.map((t, i) => (
          <div key={i} className="row">
            <select aria-label="Médico" value={t.doctorKey} style={{ width: 'auto' }} onChange={(e) => change((x) => ({ ...x, timeOff: at(x.timeOff, i, { doctorKey: e.target.value }) }))}>
              <option value="">Médico…</option>{d.doctors.map((o) => <option key={o.key} value={o.key}>{o.displayName}</option>)}</select>
            <label className="row" style={{ fontWeight: 400 }}>del<input type="date" value={t.from} style={{ width: 'auto' }} onChange={(e) => change((x) => ({ ...x, timeOff: at(x.timeOff, i, { from: e.target.value }) }))} /></label>
            <label className="row" style={{ fontWeight: 400 }}>al<input type="date" value={t.to} style={{ width: 'auto' }} onChange={(e) => change((x) => ({ ...x, timeOff: at(x.timeOff, i, { to: e.target.value }) }))} /></label>
            <input aria-label="Motivo" value={t.reason} maxLength={200} placeholder="Motivo" style={{ width: 180 }} onChange={(e) => change((x) => ({ ...x, timeOff: at(x.timeOff, i, { reason: e.target.value }) }))} />
            <button type="button" className="ghost" aria-label="Quitar" onClick={() => change((x) => ({ ...x, timeOff: x.timeOff.filter((_, j) => j !== i) }))}>✕</button>
          </div>
        ))}
        <div><button type="button" onClick={() => change((x) => ({ ...x, timeOff: [...x.timeOff, { doctorKey: doctorKey, from: '', to: '', reason: '' }] }))}>+ Día bloqueado</button></div>
      </div>
    </div>
  );
}

function RulesSection({ d, change, issues }: SectionProps) {
  const set = (patch: Partial<Data['rules']>) => change((x) => ({ ...x, rules: { ...x.rules, ...patch } }));
  return (
    <div className="card stack">
      <h2>Reglas de reserva en línea</h2>
      <Issues issues={issues} />
      <p className="small muted">Valores sugeridos ya marcados; se pueden cambiar después desde el panel.</p>
      <label className="check"><input type="checkbox" checked={d.rules.bookingEnabled} onChange={(e) => set({ bookingEnabled: e.target.checked })} />Aceptar reservas en línea (las abrimos al terminar la prueba interna)</label>
      <div className="grid">
        <label>Anticipación mínima para reservar (horas)<input type="number" min={0} max={168} step={0.5} value={d.rules.minNoticeMinutes / 60} onChange={(e) => set({ minNoticeMinutes: Math.round(Number(e.target.value) * 60) })} /></label>
        <label>Reservar hasta (días hacia adelante)<input type="number" min={1} max={365} value={d.rules.horizonDays} onChange={(e) => set({ horizonDays: Number(e.target.value) || 1 })} /></label>
        <label>El paciente puede cancelar en línea hasta (horas antes)<input type="number" min={0} max={168} step={0.5} value={d.rules.patientCancelMinMinutes / 60} onChange={(e) => set({ patientCancelMinMinutes: Math.round(Number(e.target.value) * 60) })} /></label>
      </div>
    </div>
  );
}

function CommunicationSection({ d, change, issues }: SectionProps) {
  const set = (patch: Partial<Data['communication']>) => change((x) => ({ ...x, communication: { ...x.communication, ...patch } }));
  const c = d.communication;
  return (
    <div className="card stack">
      <h2>Comunicación con pacientes</h2>
      <Issues issues={issues} />
      <fieldset className="row" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 600 }}>Recordatorios por correo antes de la cita (hasta 3)</legend>
        {REMINDERS.map((r) => (
          <label key={r.m} className="check"><input type="checkbox" checked={c.reminderOffsets.includes(r.m)} disabled={!c.reminderOffsets.includes(r.m) && c.reminderOffsets.length >= 3}
            onChange={(e) => set({ reminderOffsets: e.target.checked ? [...c.reminderOffsets, r.m] : c.reminderOffsets.filter((x) => x !== r.m) })} />{r.l} antes</label>
        ))}
      </fieldset>
      <label className="check"><input type="checkbox" checked={c.reviewsEnabled} onChange={(e) => set({ reviewsEnabled: e.target.checked })} />Invitar a opinar tras cada cita atendida y mostrar las opiniones verificadas</label>
      <label>¿Quién modera las opiniones y responde por los médicos?<input value={c.moderator} maxLength={120} onChange={(e) => set({ moderator: e.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={c.whatsapp} onChange={(e) => set({ whatsapp: e.target.checked })} />Queremos recordatorios también por WhatsApp (requiere cuenta de WhatsApp Business; te contactamos)</label>
    </div>
  );
}

function PrivacySection({ d, change, issues }: SectionProps) {
  const set = (patch: Partial<Data['privacy']>) => change((x) => ({ ...x, privacy: { ...x.privacy, ...patch } }));
  const p = d.privacy;
  return (
    <div className="card stack">
      <h2>Privacidad</h2>
      <p className="small muted">Antes de atender pacientes reales por Medora, la clínica necesita un aviso de privacidad vigente (LFPDPPP) que mencione la reserva en línea, los recordatorios y las opiniones.</p>
      <Issues issues={issues} />
      <label>Enlace al aviso de privacidad<input value={p.noticeUrl} maxLength={500} placeholder="https://…" onChange={(e) => set({ noticeUrl: e.target.value })} /></label>
      <label>…o pega aquí el texto<textarea value={p.noticeText} maxLength={20000} onChange={(e) => set({ noticeText: e.target.value })} /></label>
      <div className="grid">
        <label>Responsable de datos personales *<input value={p.officerName} maxLength={120} onChange={(e) => set({ officerName: e.target.value })} /></label>
        <label>Su correo *<input type="email" value={p.officerEmail} maxLength={254} onChange={(e) => set({ officerEmail: e.target.value })} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={p.approved} onChange={(e) => set({ approved: e.target.checked })} />* La dirección de la clínica autoriza publicar su página, sus médicos y las opiniones verificadas.</label>
      <label className="check"><input type="checkbox" checked={p.directory} onChange={(e) => set({ directory: e.target.checked })} />Aparecer también en el directorio de Medora, donde los pacientes buscan médico por especialidad y zona.</label>
    </div>
  );
}

function ContactsSection({ d, change, issues, allIssues, status, token, beforeSubmit, onSubmitted, goTo }: SectionProps & {
  allIssues: Issue[]; status: Loaded['status']; token: string; beforeSubmit: () => Promise<void>; onSubmitted: () => void; goTo: (id: SectionId) => void;
}) {
  const set = (patch: Partial<Data['contacts']>) => change((x) => ({ ...x, contacts: { ...x.contacts, ...patch } }));
  const k = d.contacts;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const required = allIssues.filter((i) => i.required);
  async function submit() {
    setBusy(true); setMsg(null);
    try {
      await beforeSubmit();
      await anon.request('POST', '/api/public/onboarding/submit', { token }, false);
      onSubmitted();
      setMsg({ ok: true, text: '¡Listo! Recibimos el alta. La revisamos y te contactamos para la capacitación.' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : errorMessage(e) });
    } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <div className="card stack">
        <h2>Contacto para la prueba</h2>
        <Issues issues={issues} />
        <div className="grid">
          <label>Responsable de la prueba *<input value={k.responsibleName} maxLength={120} onChange={(e) => set({ responsibleName: e.target.value })} /></label>
          <label>Teléfono / WhatsApp *<input value={k.responsiblePhone} maxLength={30} inputMode="tel" onChange={(e) => set({ responsiblePhone: e.target.value })} /></label>
          <label>Correo<input type="email" value={k.responsibleEmail} maxLength={254} onChange={(e) => set({ responsibleEmail: e.target.value })} /></label>
          <label>Recepción (día a día)<input value={k.receptionName} maxLength={120} onChange={(e) => set({ receptionName: e.target.value })} /></label>
          <label>Teléfono de recepción<input value={k.receptionPhone} maxLength={30} inputMode="tel" onChange={(e) => set({ receptionPhone: e.target.value })} /></label>
        </div>
      </div>
      <div className="card stack">
        <h2>Enviar para revisión</h2>
        {required.length ? (
          <>
            <p>Faltan <strong>{required.length}</strong> datos indispensables:</p>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {required.map((i, n) => (
                <li key={n}><button type="button" className="ghost small" style={{ padding: 0, minHeight: 0 }} onClick={() => goTo(i.section as SectionId)}>{SECTIONS.find((s) => s.id === i.section)?.label}</button>: {i.message}</li>
              ))}
            </ul>
          </>
        ) : <p>Todo lo indispensable está completo. Al enviarlo lo revisamos y cargamos su clínica en Medora.</p>}
        <p className="small muted">No incluyan aquí datos de pacientes: las citas ya agendadas se capturan en el panel durante la prueba interna.</p>
        {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="status">{msg.text}</div>}
        <div><button type="button" className="primary" disabled={busy || required.length > 0 || status === 'IMPORTED'} onClick={submit}>
          {busy ? 'Enviando…' : status === 'SUBMITTED' ? 'Volver a enviar con los cambios' : 'Enviar para revisión'}</button></div>
      </div>
    </div>
  );
}
