'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from '@/components/Header';
import { ApiError, StaffSessionData, errorMessage, staffSession } from '@/lib/api';
import { useSession } from '@/lib/hooks';
import { fmtDate, fmtTime } from '@/lib/format';

interface Diagnosis { code: string | null; description: string }
type Vitals = Partial<Record<keyof typeof VITALS, number>>;
interface Note {
  id: string; appointmentId: string | null; amendsId: string | null; doctorId: string; doctorName: string; authorName: string; mine: boolean;
  subjective: string; objective: string; assessment: string; plan: string; vitals: Vitals; diagnoses: Diagnosis[];
  signedAt: string | null; createdAt: string;
}
interface Item { drug: string; presentation: string; dose: string; route: string; frequency: string; duration: string; instructions?: string }
interface Rx {
  id: string; code: string; noteId: string | null; doctorName: string; items: Item[]; instructions: string | null; diagnosis: string | null;
  issuedAt: string; voidedAt: string | null; voidReason: string | null;
}
interface Record_ {
  patient: { id: string; name: string; phone: string; email: string | null };
  canWrite: boolean; filesEnabled: boolean;
  profile: { birthDate: string | null; sex: string | null; curp: string | null; bloodType: string | null; history: Record<string, string>; updatedByName: string | null; updatedAt: string } | null;
  allergies: { id: string; substance: string; reaction: string | null; severity: string; active: boolean; recordedByName: string; createdAt: string }[];
  notes: Note[];
  prescriptions: Rx[];
  files: { id: string; filename: string; mimeType: string; size: number; uploadedByName: string; createdAt: string }[];
}

const VITALS = {
  systolic: 'TA sistólica (mmHg)', diastolic: 'TA diastólica (mmHg)', heartRate: 'Frec. cardiaca (lpm)', respRate: 'Frec. respiratoria (rpm)',
  temperature: 'Temperatura (°C)', spo2: 'SatO₂ (%)', weightKg: 'Peso (kg)', heightCm: 'Talla (cm)', glucose: 'Glucosa capilar (mg/dL)',
} as const;
const HISTORY: [string, string][] = [
  ['heredofamiliares', 'Antecedentes heredofamiliares'], ['personalesPatologicos', 'Antecedentes personales patológicos'],
  ['personalesNoPatologicos', 'Antecedentes personales no patológicos'], ['ginecoObstetricos', 'Antecedentes gineco-obstétricos'],
  ['padecimientoActual', 'Padecimiento actual'], ['interrogatorioSistemas', 'Interrogatorio por aparatos y sistemas'],
  ['exploracionFisica', 'Exploración física'], ['estudios', 'Resultados de estudios'], ['diagnosticos', 'Diagnósticos o problemas clínicos'],
  ['pronostico', 'Pronóstico'], ['tratamiento', 'Indicación terapéutica'],
];
const SEVERITY: Record<string, string> = { LEVE: 'Leve', MODERADA: 'Moderada', GRAVE: 'Grave' };
const ACTION: Record<string, string> = {
  VIEW_RECORD: 'Consultó el expediente', UPDATE_HISTORY: 'Actualizó la historia clínica', ADD_ALLERGY: 'Registró una alergia',
  UPDATE_ALLERGY: 'Cambió una alergia', CREATE_NOTE: 'Creó una nota', UPDATE_NOTE: 'Editó una nota', SIGN_NOTE: 'Firmó una nota',
  PRESCRIBE: 'Emitió una receta', PRINT_PRESCRIPTION: 'Imprimió una receta', VOID_PRESCRIPTION: 'Anuló una receta',
  UPLOAD_FILE: 'Subió un archivo', DOWNLOAD_FILE: 'Abrió un archivo', VIEW_LOG: 'Consultó la bitácora', DENIED: 'Intento sin permiso',
};
const ROLE: Record<string, string> = { OWNER: 'Propietario', ADMIN: 'Administración', RECEPTION: 'Recepción', DOCTOR: 'Médico' };
const EMPTY_ITEM: Item = { drug: '', presentation: '', dose: '', route: 'oral', frequency: '', duration: '', instructions: '' };

function age(birth: string | null) {
  if (!birth) return null;
  const b = new Date(`${birth}T12:00:00`);
  const now = new Date();
  let y = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) y -= 1;
  return `${y} años`;
}

/** Abre un PDF o archivo protegido en otra pestaña. La pestaña se abre al hacer clic (si no, el navegador la bloquea). */
async function openBlob(path: string, win: Window | null = window.open('', '_blank')) {
  try {
    const res = await staffSession.raw('GET', path);
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) { win?.close(); throw e; }
}

export function ClinicalRecord() {
  const { data: session, ready } = useSession(staffSession);
  const [ids, setIds] = useState<{ patient: string; appointment: string | null } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const p = q.get('paciente');
    if (p && /^[0-9a-f-]{36}$/.test(p)) setIds({ patient: p, appointment: q.get('cita') });
  }, []);
  if (!ready) return (<><Header /><main className="container section"><p className="muted">Cargando…</p></main></>);
  if (!session) return (<><Header /><main className="container narrow section"><p>Inicia sesión en el <Link href="/login">panel</Link> para abrir el expediente.</p></main></>);
  if (!ids) return (<><Header /><main className="container narrow section"><div className="alert error">Falta el paciente.</div></main></>);
  return <RecordView session={session} patientId={ids.patient} appointmentId={ids.appointment} />;
}

function RecordView({ session, patientId, appointmentId }: { session: StaffSessionData; patientId: string; appointmentId: string | null }) {
  const tz = session.clinic.timezone;
  const base = `/api/clinic/patients/${patientId}/record`;
  const [r, setR] = useState<Record_ | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'consulta' | 'historia' | 'recetas' | 'archivos' | 'bitacora'>('consulta');

  const load = useCallback(async () => {
    try { setR(await staffSession.get<Record_>(base)); } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) setDenied(e.message); else setError(errorMessage(e));
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  async function run<T>(fn: () => Promise<T>, ok?: string): Promise<T | null> {
    setError(null); setNotice(null);
    try { const v = await fn(); if (ok) setNotice(ok); await load(); return v; } catch (e) { setError(errorMessage(e)); return null; }
  }

  const header = <Header><Link className="btn ghost" href="/panel">Volver al panel</Link></Header>;
  if (denied) return (<>{header}<main className="container narrow section"><div className="alert warn" role="alert">{denied}</div><p className="small muted">El intento quedó registrado en la bitácora del expediente.</p></main></>);
  if (!r) return (<>{header}<main className="container section">{error ? <div className="alert error">{error}</div> : <p className="muted">Cargando…</p>}</main></>);

  const active = r.allergies.filter((a) => a.active);
  return (
    <>
      {header}
      <main className="container section stack">
        <div className="card stack" style={{ gap: 6 }}>
          <div className="row">
            <h1 style={{ margin: 0, fontSize: '1.5rem' }}>{r.patient.name}</h1>
            {!r.canWrite && <span className="badge">Sólo lectura</span>}
          </div>
          <span className="small muted">
            {[age(r.profile?.birthDate ?? null), r.profile?.sex ? { F: 'Femenino', M: 'Masculino', X: 'Otro' }[r.profile.sex] : null,
              r.profile?.bloodType ? `Grupo ${r.profile.bloodType}` : null, r.profile?.curp ? `CURP ${r.profile.curp}` : null, r.patient.phone]
              .filter(Boolean).join(' · ')}
          </span>
          <div className="row">
            <strong className="small">Alergias:</strong>
            {active.length === 0 ? <span className="small muted">sin alergias registradas</span>
              : active.map((a) => <span key={a.id} className="badge CANCELLED">{a.substance} · {SEVERITY[a.severity]}</span>)}
          </div>
        </div>
        {notice && <div className="alert ok" role="status">{notice}</div>}
        {error && <div className="alert error" role="alert">{error}</div>}
        <nav className="tabs" aria-label="Secciones del expediente">
          {([['consulta', 'Consultas'], ['historia', 'Historia clínica y alergias'], ['recetas', `Recetas (${r.prescriptions.length})`],
            ['archivos', `Archivos (${r.files.length})`], ['bitacora', 'Bitácora']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>
        {tab === 'consulta' && <Consultas r={r} base={base} tz={tz} appointmentId={appointmentId} run={run} />}
        {tab === 'historia' && <Historia r={r} base={base} tz={tz} run={run} />}
        {tab === 'recetas' && <Recetas r={r} base={base} tz={tz} run={run} />}
        {tab === 'archivos' && <Archivos r={r} base={base} tz={tz} run={run} />}
        {tab === 'bitacora' && <Bitacora base={base} tz={tz} />}
      </main>
    </>
  );
}

type Run = <T>(fn: () => Promise<T>, ok?: string) => Promise<T | null>;
interface TabProps { r: Record_; base: string; tz: string; run: Run }

// ---------------------------------------------------------------- consultas (notas SOAP)

function Consultas({ r, base, tz, appointmentId, run }: TabProps & { appointmentId: string | null }) {
  const [editing, setEditing] = useState<Note | 'new' | { amends: Note } | null>(
    () => (r.canWrite && appointmentId && !r.notes.some((n) => n.appointmentId === appointmentId) ? 'new' : null),
  );
  const [prescribing, setPrescribing] = useState<Note | null>(null);
  const originals = r.notes.filter((n) => !n.amendsId);
  const addenda = (id: string) => r.notes.filter((n) => n.amendsId === id).reverse();

  return (
    <div className="stack">
      {r.canWrite && !editing && (
        <div className="row"><button className="primary" onClick={() => setEditing('new')}>Nueva nota de evolución</button></div>
      )}
      {editing && (
        <NoteForm base={base} note={editing === 'new' || 'amends' in editing ? null : editing}
          amends={editing !== 'new' && 'amends' in editing ? editing.amends : null}
          appointmentId={editing === 'new' ? appointmentId : null} run={run}
          onDone={(saved) => { setEditing(null); if (saved?.signedAt && !saved.amendsId) setPrescribing(saved); }} />
      )}
      {prescribing && <PrescriptionForm base={base} note={prescribing} run={run} onDone={() => setPrescribing(null)} />}
      {originals.length === 0 && !editing && <p className="muted">Aún no hay notas en el expediente.</p>}
      {originals.map((n) => (
        <div key={n.id} className="card stack" style={{ gap: 8 }}>
          <NoteView n={n} tz={tz} />
          {addenda(n.id).map((a) => (
            <div key={a.id} style={{ borderLeft: '3px solid var(--border)', paddingLeft: 12 }}><NoteView n={a} tz={tz} addendum /></div>
          ))}
          {r.canWrite && (
            <div className="row">
              {n.mine && !n.signedAt && <button onClick={() => setEditing(n)}>Continuar nota</button>}
              {n.signedAt && <button onClick={() => setEditing({ amends: n })}>Agregar adenda</button>}
              {n.signedAt && <button onClick={() => setPrescribing(n)}>Recetar</button>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function NoteView({ n, tz, addendum = false }: { n: Note; tz: string; addendum?: boolean }) {
  const v = n.vitals ?? {};
  const bmi = v.weightKg && v.heightCm ? (v.weightKg / (v.heightCm / 100) ** 2).toFixed(1) : null;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row">
        <strong>{addendum ? 'Adenda' : 'Nota de evolución'} · {fmtDate(n.createdAt, tz, { day: 'numeric', month: 'short', year: 'numeric' })} {fmtTime(n.createdAt, tz)}</strong>
        <span className="small muted">{n.doctorName}</span>
        {n.signedAt ? <span className="badge COMPLETED">Firmada {fmtTime(n.signedAt, tz)}</span> : <span className="badge NO_SHOW">Borrador</span>}
      </div>
      {Object.keys(v).length > 0 && (
        <span className="small muted">
          {[v.systolic && v.diastolic ? `TA ${v.systolic}/${v.diastolic}` : null, v.heartRate ? `FC ${v.heartRate}` : null, v.respRate ? `FR ${v.respRate}` : null,
            v.temperature ? `T ${v.temperature} °C` : null, v.spo2 ? `SatO₂ ${v.spo2}%` : null, v.weightKg ? `Peso ${v.weightKg} kg` : null,
            v.heightCm ? `Talla ${v.heightCm} cm` : null, bmi ? `IMC ${bmi}` : null, v.glucose ? `Glucosa ${v.glucose} mg/dL` : null].filter(Boolean).join(' · ')}
        </span>
      )}
      {([['S', n.subjective], ['O', n.objective], ['A', n.assessment], ['P', n.plan]] as const).filter(([, t]) => t).map(([k, t]) => (
        <p key={k} className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}><strong>{k}:</strong> {t}</p>
      ))}
      {n.diagnoses.length > 0 && (
        <div className="row">{n.diagnoses.map((d, i) => <span key={i} className="badge">{d.code ? `${d.code} · ` : ''}{d.description}</span>)}</div>
      )}
    </div>
  );
}

function NoteForm({ base, note, amends, appointmentId, run, onDone }: {
  base: string; note: Note | null; amends: Note | null; appointmentId: string | null; run: Run; onDone: (saved: Note | null) => void;
}) {
  const [soap, setSoap] = useState({ subjective: note?.subjective ?? '', objective: note?.objective ?? '', assessment: note?.assessment ?? '', plan: note?.plan ?? '' });
  const [vitals, setVitals] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(note?.vitals ?? {}).map(([k, v]) => [k, String(v)])));
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>(note?.diagnoses ?? []);
  const [busy, setBusy] = useState(false);
  const body = () => ({
    ...soap, diagnoses,
    vitals: Object.fromEntries(Object.entries(vitals).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v.replace(',', '.'))])),
  });

  async function save(sign: boolean) {
    setBusy(true);
    const saved = await run(async () => {
      const n = note
        ? await staffSession.patch<Note>(`${base}/notes/${note.id}`, body())
        : await staffSession.post<Note>(`${base}/notes`, { ...body(), ...(appointmentId ? { appointmentId } : {}), ...(amends ? { amendsId: amends.id } : {}) });
      return sign ? staffSession.post<Note>(`${base}/notes/${n.id}/sign`, {}) : n;
    }, sign ? 'Nota firmada. Ya no se puede modificar; las correcciones van en una adenda.' : 'Borrador guardado.');
    setBusy(false);
    if (saved) onDone(saved);
  }

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{amends ? 'Adenda a la nota firmada' : note ? 'Continuar nota' : 'Nueva nota de evolución'}</h2>
      {!amends && (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 600 }}>Signos vitales</legend>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
            {Object.entries(VITALS).map(([k, label]) => (
              <label key={k} className="small">{label}
                <input inputMode="decimal" value={vitals[k] ?? ''} onChange={(e) => setVitals({ ...vitals, [k]: e.target.value })} />
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label>S · Subjetivo (motivo de consulta, síntomas)<textarea value={soap.subjective} maxLength={10000} onChange={(e) => setSoap({ ...soap, subjective: e.target.value })} /></label>
      <label>O · Objetivo (exploración física, estudios)<textarea value={soap.objective} maxLength={10000} onChange={(e) => setSoap({ ...soap, objective: e.target.value })} /></label>
      <label>A · Análisis (impresión diagnóstica)<textarea value={soap.assessment} maxLength={10000} onChange={(e) => setSoap({ ...soap, assessment: e.target.value })} /></label>
      <label>P · Plan (tratamiento, estudios, seguimiento)<textarea value={soap.plan} maxLength={10000} onChange={(e) => setSoap({ ...soap, plan: e.target.value })} /></label>
      <DiagnosisPicker value={diagnoses} onChange={setDiagnoses} />
      <div className="row">
        <button className="primary" disabled={busy} onClick={() => save(true)}>Guardar y firmar</button>
        <button disabled={busy} onClick={() => save(false)}>Guardar borrador</button>
        <button className="ghost" disabled={busy} onClick={() => onDone(null)}>Cancelar</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Al firmar, la nota queda con tu nombre, fecha y hora, y ya no se puede cambiar.</p>
    </div>
  );
}

function DiagnosisPicker({ value, onChange }: { value: Diagnosis[]; onChange: (d: Diagnosis[]) => void }) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<{ code: string; description: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setOptions([]); return; }
    const t = setTimeout(() => { staffSession.get(`/api/clinic/icd10?q=${encodeURIComponent(q.trim())}`).then(setOptions).catch(() => undefined); }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const add = (d: Diagnosis) => { if (value.length < 10) onChange([...value, d]); setQ(''); setOptions([]); };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <label>Diagnósticos (CIE-10)
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca por código o nombre: «J02», «faringitis»…" />
      </label>
      {options.length > 0 && (
        <div className="stack" style={{ gap: 2 }}>
          {options.map((o) => <button key={o.code} type="button" className="ghost small" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => add(o)}><strong>{o.code}</strong>&nbsp;{o.description}</button>)}
        </div>
      )}
      {q.trim().length >= 3 && <button type="button" className="ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => add({ code: null, description: q.trim() })}>Agregar «{q.trim()}» sin código</button>}
      <div className="row">
        {value.map((d, i) => (
          <span key={i} className="badge">{d.code ? `${d.code} · ` : ''}{d.description}
            <button type="button" className="ghost small" aria-label={`Quitar ${d.description}`} style={{ padding: '0 4px', minHeight: 0 }} onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- recetas

function PrescriptionForm({ base, note, run, onDone }: { base: string; note: Note | null; run: Run; onDone: () => void }) {
  const [items, setItems] = useState<Item[]>([{ ...EMPTY_ITEM }]);
  const [diagnosis, setDiagnosis] = useState(note?.diagnoses.map((d) => `${d.code ? `${d.code} ` : ''}${d.description}`).join('; ') ?? '');
  const [instructions, setInstructions] = useState('');
  const set = (i: number, patch: Partial<Item>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function issue() {
    const win = window.open('', '_blank');
    const rx = await run(() => staffSession.post<Rx>(`${base}/prescriptions`, {
      noteId: note?.id, items: items.filter((i) => i.drug.trim()), diagnosis, instructions,
    }), 'Receta emitida.');
    if (!rx) { win?.close(); return; }
    onDone();
    await openBlob(`${base}/prescriptions/${rx.id}/pdf`, win).catch(() => undefined);
  }

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Receta</h2>
      {items.map((it, i) => (
        <div key={i} className="stack" style={{ gap: 6, borderTop: i ? '1px solid var(--border)' : undefined, paddingTop: i ? 8 : 0 }}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            <label className="small">Medicamento (genérico) *<input value={it.drug} maxLength={200} onChange={(e) => set(i, { drug: e.target.value })} placeholder="Paracetamol" /></label>
            <label className="small">Presentación<input value={it.presentation} maxLength={120} onChange={(e) => set(i, { presentation: e.target.value })} placeholder="Tabletas 500 mg" /></label>
            <label className="small">Dosis *<input value={it.dose} maxLength={120} onChange={(e) => set(i, { dose: e.target.value })} placeholder="1 tableta" /></label>
            <label className="small">Vía<input value={it.route} maxLength={60} onChange={(e) => set(i, { route: e.target.value })} /></label>
            <label className="small">Frecuencia *<input value={it.frequency} maxLength={120} onChange={(e) => set(i, { frequency: e.target.value })} placeholder="cada 8 horas" /></label>
            <label className="small">Duración<input value={it.duration} maxLength={120} onChange={(e) => set(i, { duration: e.target.value })} placeholder="5 días" /></label>
          </div>
          <div className="row">
            <input aria-label="Indicaciones del medicamento" value={it.instructions ?? ''} maxLength={300} onChange={(e) => set(i, { instructions: e.target.value })} placeholder="Indicaciones de este medicamento (opcional)" style={{ flex: 1 }} />
            {items.length > 1 && <button type="button" className="ghost" aria-label="Quitar medicamento" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>}
          </div>
        </div>
      ))}
      {items.length < 15 && <div><button type="button" onClick={() => setItems([...items, { ...EMPTY_ITEM }])}>+ Medicamento</button></div>}
      <label>Diagnóstico<input value={diagnosis} maxLength={500} onChange={(e) => setDiagnosis(e.target.value)} /></label>
      <label>Indicaciones generales<textarea value={instructions} maxLength={2000} onChange={(e) => setInstructions(e.target.value)} /></label>
      <div className="row">
        <button className="primary" onClick={issue} disabled={!items.some((i) => i.drug.trim() && i.dose.trim() && i.frequency.trim())}>Emitir e imprimir</button>
        <button className="ghost" onClick={onDone}>Cancelar</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>La receta lleva tus datos, tu cédula y un código QR para que la farmacia la verifique. Una vez emitida no se modifica; sólo se puede anular.</p>
    </div>
  );
}

function Recetas({ r, base, tz, run }: TabProps) {
  const [writing, setWriting] = useState(false);
  return (
    <div className="stack">
      {r.canWrite && !writing && <div><button className="primary" onClick={() => setWriting(true)}>Nueva receta</button></div>}
      {writing && <PrescriptionForm base={base} note={null} run={run} onDone={() => setWriting(false)} />}
      {r.prescriptions.length === 0 && <p className="muted">Sin recetas.</p>}
      {r.prescriptions.map((p) => (
        <div key={p.id} className="card stack" style={{ gap: 4, opacity: p.voidedAt ? 0.65 : 1 }}>
          <div className="row">
            <strong>{fmtDate(p.issuedAt, tz, { day: 'numeric', month: 'short', year: 'numeric' })} · {p.doctorName}</strong>
            <span className="small muted">Folio {p.code}</span>
            {p.voidedAt && <span className="badge CANCELLED">Anulada: {p.voidReason}</span>}
          </div>
          <span className="small">{p.items.map((i) => `${i.drug} ${i.presentation}`.trim()).join(' · ')}</span>
          <div className="row">
            <button className="small" onClick={() => run(() => openBlob(`${base}/prescriptions/${p.id}/pdf`))}>Imprimir</button>
            {r.canWrite && !p.voidedAt && (
              <button className="ghost small danger" onClick={() => {
                const reason = window.prompt('Motivo de la anulación');
                if (reason && reason.trim().length >= 3) void run(() => staffSession.post(`${base}/prescriptions/${p.id}/void`, { reason: reason.trim() }), 'Receta anulada.');
              }}>Anular</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- historia clínica y alergias

function Historia({ r, base, tz, run }: TabProps) {
  const [profile, setProfile] = useState({
    birthDate: r.profile?.birthDate ?? '', sex: r.profile?.sex ?? '', curp: r.profile?.curp ?? '', bloodType: r.profile?.bloodType ?? '',
  });
  const [history, setHistory] = useState<Record<string, string>>(r.profile?.history ?? {});
  const [allergy, setAllergy] = useState({ substance: '', reaction: '', severity: 'MODERADA' });
  const ro = !r.canWrite;
  return (
    <div className="stack">
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Alergias</h2>
        {r.allergies.length === 0 && <p className="small muted" style={{ margin: 0 }}>Sin alergias registradas.</p>}
        {r.allergies.map((a) => (
          <div key={a.id} className="row" style={{ opacity: a.active ? 1 : 0.55 }}>
            <span className={`badge ${a.active ? 'CANCELLED' : ''}`}>{a.substance}</span>
            <span className="small">{SEVERITY[a.severity]}{a.reaction ? ` · ${a.reaction}` : ''}{a.active ? '' : ' · descartada'}</span>
            <span className="small muted">{a.recordedByName}, {fmtDate(a.createdAt, tz, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            {!ro && <button className="ghost small" onClick={() => run(() => staffSession.patch(`${base}/allergies/${a.id}`, { active: !a.active }))}>{a.active ? 'Descartar' : 'Reactivar'}</button>}
          </div>
        ))}
        {!ro && (
          <form className="row" onSubmit={(e) => { e.preventDefault(); void run(() => staffSession.post(`${base}/allergies`, allergy), 'Alergia registrada.').then((x) => { if (x) setAllergy({ substance: '', reaction: '', severity: 'MODERADA' }); }); }}>
            <input aria-label="Sustancia" required minLength={2} maxLength={120} value={allergy.substance} onChange={(e) => setAllergy({ ...allergy, substance: e.target.value })} placeholder="Sustancia (p. ej. penicilina)" style={{ flex: '1 1 160px' }} />
            <input aria-label="Reacción" maxLength={200} value={allergy.reaction} onChange={(e) => setAllergy({ ...allergy, reaction: e.target.value })} placeholder="Reacción" style={{ flex: '1 1 160px' }} />
            <select aria-label="Gravedad" value={allergy.severity} onChange={(e) => setAllergy({ ...allergy, severity: e.target.value })} style={{ width: 'auto' }}>
              {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button>Agregar</button>
          </form>
        )}
      </div>
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); void run(() => staffSession.patch(`${base}/profile`, { ...profile, history }), 'Historia clínica guardada.'); }}>
        <h2 style={{ margin: 0 }}>Historia clínica</h2>
        {r.profile?.updatedByName && <p className="small muted" style={{ margin: 0 }}>Última actualización: {r.profile.updatedByName}, {fmtDate(r.profile.updatedAt, tz, { day: 'numeric', month: 'short', year: 'numeric' })}. Cada cambio queda guardado como versión.</p>}
        <fieldset className="stack" disabled={ro} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
            <label>Fecha de nacimiento<input type="date" value={profile.birthDate} onChange={(e) => setProfile({ ...profile, birthDate: e.target.value })} /></label>
            <label>Sexo<select value={profile.sex} onChange={(e) => setProfile({ ...profile, sex: e.target.value })}>
              <option value="">—</option><option value="F">Femenino</option><option value="M">Masculino</option><option value="X">Otro</option></select></label>
            <label>Grupo sanguíneo<select value={profile.bloodType} onChange={(e) => setProfile({ ...profile, bloodType: e.target.value })}>
              <option value="">—</option>{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => <option key={b}>{b}</option>)}</select></label>
            <label>CURP<input value={profile.curp} maxLength={18} autoCapitalize="characters" onChange={(e) => setProfile({ ...profile, curp: e.target.value.toUpperCase() })} /></label>
          </div>
          {HISTORY.map(([k, label]) => (
            <label key={k}>{label}<textarea value={history[k] ?? ''} maxLength={5000} onChange={(e) => setHistory({ ...history, [k]: e.target.value })} /></label>
          ))}
          {!ro && <div><button className="primary">Guardar historia clínica</button></div>}
        </fieldset>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- archivos

function Archivos({ r, base, tz, run }: TabProps) {
  const [busy, setBusy] = useState(false);
  async function upload(file: File) {
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    await run(() => staffSession.raw('POST', `${base}/files`, form), 'Archivo guardado (cifrado).');
    setBusy(false);
  }
  return (
    <div className="card stack">
      {!r.filesEnabled ? <div className="alert warn">Los adjuntos aún no están habilitados en este servidor.</div> : r.canWrite && (
        <label className="btn" style={{ alignSelf: 'flex-start' }}>{busy ? 'Subiendo…' : 'Subir estudio (PDF, JPG o PNG, hasta 10 MB)'}
          <input type="file" accept="application/pdf,image/jpeg,image/png" hidden disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        </label>
      )}
      {r.files.length === 0 && <p className="small muted" style={{ margin: 0 }}>Sin archivos.</p>}
      {r.files.map((f) => (
        <div key={f.id} className="row">
          <button className="ghost small" onClick={() => run(() => openBlob(`${base}/files/${f.id}`))}>{f.filename}</button>
          <span className="small muted">{Math.ceil(f.size / 1024)} KB · {f.uploadedByName} · {fmtDate(f.createdAt, tz, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- bitácora

function Bitacora({ base, tz }: { base: string; tz: string }) {
  const [rows, setRows] = useState<{ userName: string; role: string; action: string; createdAt: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { staffSession.get(`${base}/log`).then(setRows).catch((e) => setError(errorMessage(e))); }, [base]);
  const list = useMemo(() => rows ?? [], [rows]);
  if (error) return <div className="alert error">{error}</div>;
  if (!rows) return <p className="muted">Cargando…</p>;
  return (
    <div className="card table-wrap">
      <p className="small muted">Cada consulta, cambio, impresión e intento sin permiso queda registrado y no se puede borrar.</p>
      <table>
        <thead><tr><th>Fecha</th><th>Persona</th><th>Acción</th></tr></thead>
        <tbody>
          {list.map((x, i) => (
            <tr key={i}>
              <td className="small">{fmtDate(x.createdAt, tz, { day: 'numeric', month: 'short', year: 'numeric' })} {fmtTime(x.createdAt, tz)}</td>
              <td className="small">{x.userName} <span className="muted">· {ROLE[x.role] ?? x.role}</span></td>
              <td className="small" style={x.action === 'DENIED' ? { color: 'var(--danger)' } : undefined}>{ACTION[x.action] ?? x.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
