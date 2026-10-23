'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { ApiError, errorMessage, staffSession } from '@/lib/api';
import { useSession } from '@/lib/hooks';
import { fmtDate } from '@/lib/format';

interface Row {
  id: string; name: string; slug: string; phone: string | null; createdAt: string; plan: string; status: string; active: boolean;
  exempt: boolean; trialEndsAt: string | null; verification: 'PENDING' | 'VERIFIED' | 'REJECTED'; verificationNote: string | null;
  doctors: { displayName: string; specialty: string; licenseNumber: string | null }[]; owners: { name: string; email: string }[];
}

const SEP = 'https://www.cedulaprofesional.sep.gob.mx/cedula/presidencia/indexAvanzada.action';
const VERIF: Record<string, string> = { PENDING: 'Por verificar', VERIFIED: 'Verificada', REJECTED: 'Rechazada' };

/** Administración de Medora: verificación de cédulas y cortesías. */
export function Admin() {
  const { data: session, ready } = useSession(staffSession);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => staffSession.get<Row[]>('/api/admin/clinics').then(setRows)
    .catch((e) => setError(e instanceof ApiError && e.status === 403 ? 'Esta página es sólo para la administración de Medora.' : errorMessage(e))), []);
  useEffect(() => { if (session) void load(); }, [session, load]);

  async function review(r: Row, body: object) {
    setError(null);
    try { await staffSession.patch(`/api/admin/clinics/${r.id}`, body); await load(); } catch (e) { setError(errorMessage(e)); }
  }

  if (!ready) return (<><Header /><main className="container section"><p className="muted">Cargando…</p></main></>);
  if (!session) return (<><Header /><main className="container narrow section"><p>Inicia sesión en el <Link href="/login">panel</Link>.</p></main></>);
  return (
    <>
      <Header><Link className="btn ghost" href="/panel">Panel</Link></Header>
      <main className="container section stack">
        <h1>Clínicas</h1>
        {error && <div className="alert error" role="alert">{error}</div>}
        {rows?.map((r) => (
          <div key={r.id} className="card stack" style={{ gap: 6 }}>
            <div className="row">
              <strong>{r.name}</strong>
              <span className={`badge ${r.verification === 'VERIFIED' ? 'COMPLETED' : r.verification === 'REJECTED' ? 'CANCELLED' : 'NO_SHOW'}`}>{VERIF[r.verification]}</span>
              <span className="badge">{r.exempt ? 'Sin costo' : `${r.plan} · ${r.status}`}</span>
              {!r.active && <span className="badge CANCELLED">Sin reservas en línea</span>}
              <span className="small muted">alta {fmtDate(r.createdAt, 'America/Mexico_City', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </div>
            <span className="small">{r.owners.map((o) => `${o.name} <${o.email}>`).join(', ')}{r.phone ? ` · ${r.phone}` : ''} · /c/{r.slug}</span>
            {r.doctors.map((d, i) => (
              <span key={i} className="small">{d.displayName} · {d.specialty} · Cédula <strong>{d.licenseNumber ?? '—'}</strong></span>
            ))}
            {r.verificationNote && <span className="small muted">Nota: {r.verificationNote}</span>}
            <div className="row">
              <a className="btn small" href={SEP} target="_blank" rel="noreferrer">Buscar en el RNP de la SEP</a>
              {r.verification !== 'VERIFIED' && <button className="small primary" onClick={() => review(r, { verification: 'VERIFIED' })}>Verificar</button>}
              {r.verification !== 'REJECTED' && <button className="small danger" onClick={() => {
                const note = window.prompt('Motivo (se le envía a la clínica)');
                if (note?.trim()) void review(r, { verification: 'REJECTED', note: note.trim() });
              }}>Rechazar</button>}
              <button className="small ghost" onClick={() => review(r, { billingExempt: !r.exempt })}>{r.exempt ? 'Quitar cortesía' : 'Dar sin costo'}</button>
            </div>
          </div>
        ))}
      </main>
    </>
  );
}
