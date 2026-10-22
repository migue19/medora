'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { StaffSessionData, errorMessage, staffSession } from '@/lib/api';
import { STATUS_LABEL, fmtDate, fmtTime, money } from '@/lib/format';
import { NewAppointment, PatientChooser } from './NewAppointment';
import type { ClinicPatient, Doctor, Service } from './shared';

interface Profile {
  patient: ClinicPatient & { tags: string[]; linked: boolean; whatsappConsent: boolean; emailVerified: boolean };
  stats: { total: number; upcoming: number; completed: number; noShow: number; cancelled: number };
  appointments: {
    id: string; startsAt: string; status: string; serviceId: string; serviceName: string; priceCents: number;
    cancelReason: string | null; confirmedAt: string | null; followUpOfId: string | null; doctor: { id: string; displayName: string };
  }[];
  notes: { id: string; body: string; authorName: string; createdAt: string }[];
  audit: { id: string; action: string; actorName: string; details: Record<string, unknown>; createdAt: string }[];
  waitlist: { id: string; doctorId: string; serviceId: string; fromDate: string | null; toDate: string | null; notes: string | null }[];
  pendingLink: { createdAt: string; expiresAt: string } | null;
}

const AUDIT_LABEL: Record<string, string> = {
  CREATED: 'Ficha creada', UPDATED: 'Datos actualizados', LINK_REQUESTED: 'Se pidió vincular con cuenta en línea',
  LINKED: 'Vinculada con cuenta en línea', MERGED: 'Fusión de fichas',
};

export function PatientProfile({ session, id, doctors, onBack }: {
  session: StaffSessionData; id: string; doctors: Doctor[]; onBack: () => void;
}) {
  const tz = session.clinic.timezone;
  const canEdit = session.membership.role !== 'DOCTOR';
  const [p, setP] = useState<Profile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<null | 'edit' | 'link' | 'merge' | 'waitlist' | { book: true; followUp?: { id: string; doctorId: string; serviceId: string } }>(null);

  const load = useCallback(async () => {
    try { setP(await staffSession.get<Profile>(`/api/clinic/patients/${id}`)); } catch (e) { setError(errorMessage(e)); }
  }, [id]);
  useEffect(() => { void load(); staffSession.get<Service[]>('/api/clinic/services').then(setServices).catch(() => undefined); }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setError(null); setNotice(null);
    try { await fn(); setNotice(ok); setMode(null); await load(); } catch (e) { setError(errorMessage(e)); }
  }

  if (!p) return <div className="stack"><button className="ghost" onClick={onBack}>← Pacientes</button>{error ? <div className="alert error">{error}</div> : <p className="muted">Cargando…</p>}</div>;
  const pt = p.patient;
  const doctorName = (did: string) => doctors.find((d) => d.id === did)?.displayName ?? 'Médico';
  const serviceName = (sid: string) => services.find((s) => s.id === sid)?.name ?? 'Servicio';

  return (
    <div className="stack">
      <div className="row">
        <button className="ghost" onClick={onBack}>← Pacientes</button>
        <span className="spacer" />
        {session.membership.role !== 'RECEPTION' && <a className="btn" href={`/expediente?paciente=${id}`}>Expediente clínico</a>}
      </div>
      <div className="card stack">
        <div className="row">
          <h2 style={{ margin: 0 }}>{pt.name}</h2>
          {pt.linked && <span className="badge BOOKED">Cuenta en línea</span>}
          {pt.whatsappConsent && <span className="badge">Acepta WhatsApp</span>}
          {pt.tags.map((t) => <span key={t} className="badge">{t}</span>)}
        </div>
        <span className="small"><a href={`tel:${pt.phone.replace(/[^+\d]/g, '')}`}>{pt.phone}</a>{pt.email ? ` · ${pt.email}` : ''}</span>
        <span className="small muted">
          {p.stats.total} cita(s) · {p.stats.upcoming} próxima(s) · {p.stats.completed} atendida(s) · {' '}
          <strong style={p.stats.noShow ? { color: 'var(--warn)' } : undefined}>{p.stats.noShow} inasistencia(s)</strong> · {p.stats.cancelled} cancelada(s)
        </span>
        {p.pendingLink && <span className="small muted">Vinculación enviada el {fmtDate(p.pendingLink.createdAt, tz)}; esperando que el paciente confirme desde su correo.</span>}
        {canEdit && (
          <div className="row">
            <button className="primary" onClick={() => setMode({ book: true })}>Agendar cita</button>
            <button onClick={() => setMode('edit')}>{pt.linked ? 'Etiquetas' : 'Editar datos'}</button>
            <button onClick={() => setMode('waitlist')}>Lista de espera</button>
            {!pt.linked && <button onClick={() => setMode('link')}>Vincular con cuenta en línea</button>}
            <button onClick={() => setMode('merge')}>Fusionar duplicado</button>
          </div>
        )}
      </div>
      {notice && <div className="alert ok" role="status">{notice}</div>}
      {error && <div className="alert error" role="alert">{error}</div>}

      {mode && typeof mode === 'object' && (
        <div className="card">
          <NewAppointment session={session} doctors={doctors} patient={pt} followUp={mode.followUp}
            onClose={async (msg) => { setMode(null); if (msg) { setNotice(msg); await load(); } }} />
        </div>
      )}
      {mode === 'edit' && <EditForm p={pt} onCancel={() => setMode(null)} onSave={(body) => run(() => staffSession.patch(`/api/clinic/patients/${id}`, body), 'Ficha actualizada.')} />}
      {mode === 'link' && (
        <LinkForm defaultEmail={pt.email ?? ''} onCancel={() => setMode(null)}
          onSend={(email) => run(() => staffSession.post(`/api/clinic/patients/${id}/link`, { email }), `Enviamos a ${email} un enlace para que el paciente confirme la vinculación.`)} />
      )}
      {mode === 'merge' && (
        <div className="card stack">
          <h3>Fusionar una ficha duplicada en esta</h3>
          <p className="small muted">Las citas, notas y lista de espera de la ficha que elijas pasan a «{pt.name}», y esa ficha deja de aparecer. Queda registrado en la auditoría.</p>
          <PatientChooser onChoose={(dup) => {
            if (dup.id === pt.id) { setError('Elige otra ficha'); return; }
            if (window.confirm(`¿Fusionar «${dup.name}» (${dup.phone}) en «${pt.name}»? No se puede deshacer.`)) {
              void run(() => staffSession.post(`/api/clinic/patients/${id}/merge`, { sourceId: dup.id }), `«${dup.name}» se fusionó en esta ficha.`);
            }
          }} />
          <div><button onClick={() => setMode(null)}>Cancelar</button></div>
        </div>
      )}
      {mode === 'waitlist' && (
        <WaitlistForm doctors={doctors} services={services} onCancel={() => setMode(null)}
          onSave={(body) => run(() => staffSession.post('/api/clinic/waitlist', { ...body, clinicPatientId: id }), 'Paciente agregado a la lista de espera.')} />
      )}

      {p.waitlist.length > 0 && (
        <div className="card stack">
          <h3>En lista de espera</h3>
          {p.waitlist.map((w) => (
            <div key={w.id} className="row small">
              <span>{doctorName(w.doctorId)} · {serviceName(w.serviceId)}{w.fromDate || w.toDate ? ` · ${w.fromDate ?? '…'} a ${w.toDate ?? '…'}` : ''}</span>
              {canEdit && <button className="danger" onClick={() => run(() => staffSession.post(`/api/clinic/waitlist/${w.id}/remove`), 'Salió de la lista de espera.')}>Quitar</button>}
            </div>
          ))}
        </div>
      )}

      <div className="card stack">
        <h3>Notas internas</h3>
        <NoteForm onAdd={(body) => run(() => staffSession.post(`/api/clinic/patients/${id}/notes`, { body }), 'Nota agregada.')} />
        {p.notes.length === 0 && <p className="muted small">Sin notas.</p>}
        {p.notes.map((n) => (
          <div key={n.id} className="stack" style={{ gap: 2 }}>
            <span style={{ whiteSpace: 'pre-wrap' }}>{n.body}</span>
            <span className="small muted">{n.authorName} · {fmtDate(n.createdAt, tz)} {fmtTime(n.createdAt, tz)}</span>
          </div>
        ))}
      </div>

      <div className="card stack table-wrap">
        <h3>Historial de citas</h3>
        {p.appointments.length === 0 ? <p className="muted small">Sin citas.</p> : (
          <table>
            <thead><tr><th>Fecha</th><th>Médico</th><th>Servicio</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {p.appointments.map((a) => (
                <tr key={a.id}>
                  <td>{fmtDate(a.startsAt, tz)} {fmtTime(a.startsAt, tz)}</td>
                  <td>{a.doctor.displayName}</td>
                  <td>{a.serviceName} · {money(a.priceCents)}{a.followUpOfId ? <div className="small muted">Subsecuente</div> : null}</td>
                  <td><span className={`badge ${a.status}`}>{STATUS_LABEL[a.status]}</span>{a.cancelReason ? <div className="small muted">{a.cancelReason}</div> : null}</td>
                  <td>{a.status === 'COMPLETED' && canEdit && (
                    <button onClick={() => setMode({ book: true, followUp: { id: a.id, doctorId: a.doctor.id, serviceId: a.serviceId } })}>Subsecuente</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {p.audit.length > 0 && (
        <details className="card">
          <summary>Auditoría de la ficha ({p.audit.length})</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            {p.audit.map((a) => (
              <div key={a.id} className="small">
                <strong>{AUDIT_LABEL[a.action] ?? a.action}</strong> · {a.actorName} · {fmtDate(a.createdAt, tz)} {fmtTime(a.createdAt, tz)}
                <div className="muted" style={{ wordBreak: 'break-word' }}>{describe(a.action, a.details)}</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function describe(action: string, d: Record<string, unknown>): string {
  if (action === 'UPDATED') {
    return Object.entries(d).map(([k, v]) => {
      const [from, to] = v as [unknown, unknown];
      const show = (x: unknown) => (Array.isArray(x) ? x.join(', ') || '—' : x === null || x === '' ? '—' : String(x));
      return `${k}: ${show(from)} → ${show(to)}`;
    }).join(' · ');
  }
  if (action === 'MERGED') {
    const src = d.source as { name: string; phone: string } | undefined;
    return src ? `Ficha «${src.name}» (${src.phone}) · ${d.appointmentsMoved} cita(s) movida(s)` : '';
  }
  if (action === 'LINK_REQUESTED' || action === 'LINKED') return String(d.email ?? d.accountEmail ?? '');
  return '';
}

function EditForm({ p, onSave, onCancel }: { p: Profile['patient']; onSave: (body: object) => void; onCancel: () => void }) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const tags = String(f.get('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    onSave(p.linked ? { tags } : {
      name: f.get('name'), phone: f.get('phone'), email: f.get('email'), tags, whatsappConsent: f.get('whatsappConsent') === 'on',
    });
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h3>{p.linked ? 'Etiquetas' : 'Editar datos'}</h3>
      {p.linked ? <p className="small muted">El paciente tiene cuenta en línea: sus datos de contacto y su preferencia de WhatsApp los actualiza él mismo.</p> : (
        <>
          <div className="grid">
            <label>Nombre<input name="name" required minLength={2} maxLength={120} defaultValue={p.name} /></label>
            <label>Teléfono<input name="phone" required inputMode="tel" pattern="\+?[0-9 \(\)\-]{8,20}" defaultValue={p.phone} /></label>
            <label>Correo<input name="email" type="email" defaultValue={p.email ?? ''} /></label>
          </div>
          <label className="check"><input type="checkbox" name="whatsappConsent" defaultChecked={p.whatsappConsent} />Acepta recordatorios por WhatsApp</label>
        </>
      )}
      <label>Etiquetas (separadas por comas)<input name="tags" defaultValue={p.tags.join(', ')} placeholder="diabetes, primera vez" /></label>
      <div className="row"><button className="primary">Guardar</button><button type="button" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}

function LinkForm({ defaultEmail, onSend, onCancel }: { defaultEmail: string; onSend: (email: string) => void; onCancel: () => void }) {
  const [email, setEmail] = useState(defaultEmail);
  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); onSend(email.trim()); }}>
      <h3>Vincular con cuenta en línea</h3>
      <p className="small muted">Si el paciente ya tiene cuenta en Medora, le enviaremos a ese correo un enlace para confirmar que esta ficha es suya. Al confirmar, verá estas citas en su portal y, si ya había reservado en línea, sus fichas se fusionan.</p>
      <label>Correo de su cuenta<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <div className="row"><button className="primary">Enviar enlace</button><button type="button" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}

function NoteForm({ onAdd }: { onAdd: (body: string) => void }) {
  const [body, setBody] = useState('');
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); if (body.trim()) { onAdd(body.trim()); setBody(''); } }}>
      <textarea value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} placeholder="Nota visible sólo para el personal de la clínica" />
      <div><button disabled={!body.trim()}>Agregar nota</button></div>
    </form>
  );
}

function WaitlistForm({ doctors, services, onSave, onCancel }: {
  doctors: Doctor[]; services: Service[]; onSave: (body: object) => void; onCancel: () => void;
}) {
  const [doctorId, setDoctorId] = useState('');
  const doctor = doctors.find((d) => d.id === doctorId);
  const options = services.filter((s) => s.active && doctor?.serviceIds.includes(s.id));
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    onSave({ doctorId, serviceId: f.get('serviceId'), fromDate: f.get('fromDate') || null, toDate: f.get('toDate') || null, notes: f.get('notes') || null });
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h3>Agregar a la lista de espera</h3>
      <div className="grid">
        <label>Médico<select required value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
          <option value="">Selecciona…</option>
          {doctors.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
        </select></label>
        <label>Servicio<select name="serviceId" required disabled={!doctor}>
          <option value="">Selecciona…</option>
          {options.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        <label>Desde (opcional)<input type="date" name="fromDate" /></label>
        <label>Hasta (opcional)<input type="date" name="toDate" /></label>
      </div>
      <label>Notas (opcional)<input name="notes" maxLength={300} placeholder="Ej. sólo por las mañanas" /></label>
      <p className="small muted">Cuando se libere un horario de ese médico, se aparta al primero de la lista y se le avisa por correo (si tiene). Si no tiene correo, verás el apartado en «Lista de espera» para llamarle.</p>
      <div className="row"><button className="primary">Agregar</button><button type="button" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}
