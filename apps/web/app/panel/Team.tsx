'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { StaffSessionData, errorMessage, staffSession } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/format';

interface Member { id: string; role: string; active: boolean; user: { name: string; email: string }; doctor: { displayName: string } | null }

export function Team({ session }: { session: StaffSessionData }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const roles = session.membership.role === 'OWNER' ? ['ADMIN', 'RECEPTION', 'DOCTOR'] : ['RECEPTION', 'DOCTOR'];
  const load = useCallback(() => staffSession.get<Member[]>('/api/clinic/members').then(setMembers).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { void load(); }, [load]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(null); setNotice(null);
    try {
      await staffSession.post('/api/clinic/members', { name: f.get('name'), email: f.get('email'), password: f.get('password'), role: f.get('role') });
      form.reset();
      setNotice('Integrante creado. Comparte sus credenciales por un medio seguro.');
      await load();
    } catch (err) { setError(errorMessage(err)); }
  }

  async function update(m: Member, body: { role?: string; active?: boolean }) {
    setError(null); setNotice(null);
    try { await staffSession.patch(`/api/clinic/members/${m.id}`, body); await load(); } catch (err) { setError(errorMessage(err)); }
  }

  return (
    <div className="stack">
      {notice && <div className="alert ok">{notice}</div>}
      {error && <div className="alert error">{error}</div>}
      <form className="card stack" onSubmit={create}>
        <h3>Agregar integrante</h3>
        <div className="grid">
          <label>Nombre<input name="name" required minLength={2} maxLength={120} /></label>
          <label>Correo<input name="email" type="email" required autoComplete="off" /></label>
          <label>Contraseña inicial<input name="password" type="password" required minLength={12} autoComplete="new-password" /></label>
          <label>Rol<select name="role">{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
        </div>
        <p className="muted small">Para médicos, después vincula el usuario a su perfil en «Médicos y horarios».</p>
        <div><button className="primary">Crear</button></div>
      </form>
      <div className="table-wrap card">
        <table>
          <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th></tr></thead>
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
