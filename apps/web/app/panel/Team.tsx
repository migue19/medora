'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { StaffSessionData, errorMessage, staffSession } from '@/lib/api';
import { ROLE_LABEL, addDays, fmtDate, fmtTime, todayIn } from '@/lib/format';

interface Member { id: string; role: string; active: boolean; clinicalAccess?: boolean; user: { name: string; email: string }; doctor: { displayName: string } | null }
interface Invitation { id: string; name: string; email: string; role: string; expiresAt: string; expired: boolean }

export function Team({ session }: { session: StaffSessionData }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const roles = session.membership.role === 'OWNER' ? ['ADMIN', 'RECEPTION', 'DOCTOR'] : ['RECEPTION', 'DOCTOR'];
  const isOwner = session.membership.role === 'OWNER';
  const load = useCallback(() => Promise.all([
    staffSession.get<Member[]>('/api/clinic/members').then(setMembers),
    staffSession.get<Invitation[]>('/api/clinic/invitations').then(setInvitations),
  ]).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { void load(); }, [load]);

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(null); setNotice(null); setBusy(true);
    try {
      const inv = await staffSession.post<Invitation>('/api/clinic/invitations', { name: f.get('name'), email: f.get('email'), role: f.get('role') });
      form.reset();
      setNotice(`Invitación enviada a ${inv.email}. Elegirá su propia contraseña al aceptarla.`);
      await load();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  async function update(m: Member, body: { role?: string; active?: boolean }) {
    setError(null); setNotice(null);
    try { await staffSession.patch(`/api/clinic/members/${m.id}`, body); await load(); } catch (err) { setError(errorMessage(err)); }
  }

  async function invitationAction(i: Invitation, action: 'resend' | 'revoke') {
    if (action === 'revoke' && !window.confirm(`¿Cancelar la invitación de ${i.email}?`)) return;
    setError(null); setNotice(null);
    try {
      await staffSession.post(`/api/clinic/invitations/${i.id}/${action}`);
      setNotice(action === 'resend' ? `Reenviamos la invitación a ${i.email} con un enlace nuevo.` : 'Invitación cancelada.');
      await load();
    } catch (err) { setError(errorMessage(err)); }
  }

  return (
    <div className="stack">
      {notice && <div className="alert ok" role="status">{notice}</div>}
      {error && <div className="alert error" role="alert">{error}</div>}
      <form className="card stack" onSubmit={invite}>
        <h3>Invitar integrante</h3>
        <div className="grid">
          <label>Nombre<input name="name" required minLength={2} maxLength={120} /></label>
          <label>Correo<input name="email" type="email" required autoComplete="off" /></label>
          <label>Rol<select name="role">{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
        </div>
        <p className="muted small">Le llegará un correo para aceptar y crear su contraseña; el enlace vence en 7 días. Para médicos, después vincula el usuario a su perfil en «Médicos y horarios».</p>
        <div><button className="primary" disabled={busy}>{busy ? 'Enviando…' : 'Enviar invitación'}</button></div>
      </form>
      {invitations.length > 0 && (
        <div className="table-wrap card">
          <h3>Invitaciones pendientes</h3>
          <table>
            <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Vence</th><th /></tr></thead>
            <tbody>
              {invitations.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td>{i.email}</td>
                  <td>{ROLE_LABEL[i.role]}</td>
                  <td>{i.expired ? <span className="badge NO_SHOW">Vencida</span> : fmtDate(i.expiresAt, session.clinic.timezone)}</td>
                  <td>{roles.includes(i.role) && (
                    <div className="row">
                      <button onClick={() => invitationAction(i, 'resend')}>Reenviar</button>
                      <button className="danger" onClick={() => invitationAction(i, 'revoke')}>Cancelar</button>
                    </div>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="table-wrap card">
        <table>
          <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th>{isOwner && <th>Expedientes clínicos</th>}</tr></thead>
          <tbody>
            {members.map((m) => {
              const editable = m.id !== session.membership.id && roles.includes(m.role);
              return (
                <tr key={m.id}>
                  <td>{m.user.name}{m.doctor ? <div className="muted small">{m.doctor.displayName}</div> : null}</td>
                  <td>{m.user.email}</td>
                  <td>{editable ? (
                    <select value={m.role} onChange={(e) => update(m, { role: e.target.value })} style={{ width: 'auto' }}>
                      {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  ) : ROLE_LABEL[m.role]}</td>
                  <td>{editable ? (
                    <button className={m.active ? 'danger' : ''} onClick={() => update(m, { active: !m.active })}>{m.active ? 'Desactivar' : 'Reactivar'}</button>
                  ) : m.active ? 'Activo' : 'Inactivo'}</td>
                  {isOwner && (
                    <td className="small">
                      {m.role === 'RECEPTION' ? <span className="muted">Sin acceso</span> : (
                        <label className="check" title="Acceso a los expedientes de todos los pacientes (p. ej. dirección médica)">
                          <input type="checkbox" checked={Boolean(m.clinicalAccess)} onChange={async (e) => {
                            setError(null);
                            try { await staffSession.patch(`/api/clinic/members/${m.id}/clinical-access`, { clinicalAccess: e.target.checked }); await load(); } catch (err) { setError(errorMessage(err)); }
                          }} />
                          {m.clinicalAccess ? 'Todos los pacientes' : m.doctor ? 'Sólo sus pacientes' : 'Sin acceso'}
                        </label>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {isOwner && <p className="small muted">Los médicos ven el expediente de los pacientes que atienden. Marca «Todos los pacientes» sólo para quien lo necesite (p. ej. la dirección médica). Recepción nunca ve información clínica.</p>}
      {isOwner && <ClinicalAudit tz={session.clinic.timezone} />}
    </div>
  );
}

const AUDIT_ACTION: Record<string, string> = {
  VIEW_RECORD: 'Consultó el expediente', UPDATE_HISTORY: 'Actualizó la historia clínica', ADD_ALLERGY: 'Registró una alergia',
  UPDATE_ALLERGY: 'Cambió una alergia', CREATE_NOTE: 'Creó una nota', UPDATE_NOTE: 'Editó una nota', SIGN_NOTE: 'Firmó una nota',
  PRESCRIBE: 'Emitió una receta', PRINT_PRESCRIPTION: 'Imprimió una receta', VOID_PRESCRIPTION: 'Anuló una receta',
  UPLOAD_FILE: 'Subió un archivo', DOWNLOAD_FILE: 'Abrió un archivo', VIEW_LOG: 'Consultó la bitácora', DENIED: 'Intento sin permiso',
};

/** Bitácora de acceso a expedientes de toda la clínica (sólo el propietario). */
function ClinicalAudit({ tz }: { tz: string }) {
  const today = todayIn(tz);
  const [from, setFrom] = useState(addDays(today, -7));
  const [rows, setRows] = useState<{ userName: string; role: string; action: string; createdAt: string; patient: { name: string } }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    staffSession.get(`/api/clinic/clinical-audit?from=${from}&to=${today}`).then(setRows).catch((e) => setError(errorMessage(e)));
  }, [from, today]);
  return (
    <div className="card stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>Bitácora de expedientes</h3>
        <span className="spacer" />
        <label className="row small" style={{ fontWeight: 400 }}>Desde<input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} /></label>
      </div>
      {error && <div className="alert error">{error}</div>}
      {rows && rows.length === 0 && <p className="small muted">Sin accesos en el periodo.</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Persona</th><th>Paciente</th><th>Acción</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="small">{fmtDate(r.createdAt, tz, { day: 'numeric', month: 'short' })} {fmtTime(r.createdAt, tz)}</td>
                  <td className="small">{r.userName} <span className="muted">· {ROLE_LABEL[r.role] ?? r.role}</span></td>
                  <td className="small">{r.patient.name}</td>
                  <td className="small" style={r.action === 'DENIED' ? { color: 'var(--danger)' } : undefined}>{AUDIT_ACTION[r.action] ?? r.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
