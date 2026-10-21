'use client';
import { useCallback, useEffect, useState } from 'react';
import { StaffSessionData, errorMessage, staffSession } from '@/lib/api';
import { fmtDate, fmtTime } from '@/lib/format';
import { Stars } from '@/components/Stars';

interface Review {
  id: string; authorName: string; rating: number; ratings: { punctuality: number; treatment: number; facilities: number };
  comment: string | null; createdAt: string; status: 'PUBLISHED' | 'HIDDEN'; anonymous: boolean;
  reply: { text: string; at: string; by: string } | null;
  hiddenReason: { code: string; label: string } | null;
  events: { type: string; actorName: string; reason: string | null; note: string | null; createdAt: string }[];
  appointment: { startsAt: string; serviceName: string }; doctor: { id: string; displayName: string }; patientName: string;
}

const EVENT: Record<string, string> = {
  CREATED: 'Publicada por el paciente', HIDDEN: 'Ocultada', RESTORED: 'Vuelta a publicar', REPLIED: 'Respuesta publicada',
  REPLY_REMOVED: 'Respuesta retirada',
};

export function Reviews({ session }: { session: StaffSessionData }) {
  const tz = session.clinic.timezone;
  const role = session.membership.role;
  const canModerate = role === 'OWNER' || role === 'ADMIN';
  const [status, setStatus] = useState('');
  const [data, setData] = useState<{ reasons: Record<string, string>; reviews: Review[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await staffSession.get(`/api/clinic/reviews${status ? `?status=${status}` : ''}`)); } catch (e) { setError(errorMessage(e)); }
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setError(null); setNotice(null);
    try { await fn(); setNotice(ok); await load(); } catch (e) { setError(errorMessage(e)); }
  }

  const published = data?.reviews.filter((r) => r.status === 'PUBLISHED') ?? [];
  const avg = published.length ? published.reduce((s, r) => s + r.rating, 0) / published.length : 0;

  return (
    <div className="stack">
      <p className="muted small">Sólo los pacientes con una cita atendida pueden opinar, una vez por cita. Les llega la invitación por correo 2 horas después de marcar «Atendida». Ocultar una opinión no la borra: queda guardada, el paciente recibe el motivo y todo queda en el historial.</p>
      <div className="row">
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }} aria-label="Filtrar opiniones">
          <option value="">Todas</option><option value="PUBLISHED">Publicadas</option><option value="HIDDEN">Ocultas</option>
        </select>
        {published.length > 0 && <span className="small row" style={{ gap: 6 }}><Stars value={avg} /> {avg.toFixed(1)} · {published.length} publicada(s)</span>}
      </div>
      {notice && <div className="alert ok" role="status">{notice}</div>}
      {error && <div className="alert error" role="alert">{error}</div>}
      {data && data.reviews.length === 0 && <p className="muted">Aún no hay opiniones.</p>}
      {data?.reviews.map((r) => (
        <div key={r.id} className="card stack" style={{ opacity: r.status === 'HIDDEN' ? 0.75 : 1 }}>
          <div className="row">
            <Stars value={r.rating} /> <strong>{r.rating.toFixed(1)}</strong>
            <span className="small muted">Puntualidad {r.ratings.punctuality} · Trato {r.ratings.treatment} · Instalaciones {r.ratings.facilities}</span>
            {r.status === 'HIDDEN' && <span className="badge CANCELLED">Oculta: {r.hiddenReason?.label}</span>}
          </div>
          {r.comment ? <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{r.comment}</p> : <span className="small muted">Sin comentario</span>}
          <span className="small muted">
            {r.patientName} (se muestra como «{r.authorName}») · {r.doctor.displayName} · {r.appointment.serviceName} del {fmtDate(r.appointment.startsAt, tz)}
          </span>
          {r.reply && <div className="alert ok small"><strong>Respuesta de {r.reply.by}:</strong> {r.reply.text}</div>}
          <div className="row">
            <ReplyEditor review={r} canReply={canModerate || (role === 'DOCTOR' && session.membership.doctorId === r.doctor.id)}
              onSave={(text) => run(() => staffSession.put(`/api/clinic/reviews/${r.id}/reply`, { text }), 'Respuesta publicada.')}
              onRemove={() => run(() => staffSession.del(`/api/clinic/reviews/${r.id}/reply`), 'Respuesta retirada.')} />
            {canModerate && data && (r.status === 'PUBLISHED'
              ? <HideForm reasons={data.reasons} onHide={(reason, note) => run(() => staffSession.post(`/api/clinic/reviews/${r.id}/hide`, { reason, note }), 'Opinión ocultada. Avisamos al paciente con el motivo.')} />
              : <button onClick={() => run(() => staffSession.post(`/api/clinic/reviews/${r.id}/restore`, {}), 'Opinión publicada de nuevo.')}>Volver a publicar</button>)}
          </div>
          <details>
            <summary className="small">Historial ({r.events.length})</summary>
            <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {r.events.map((e, i) => (
                <li key={i}>{EVENT[e.type] ?? e.type} · {e.actorName} · {fmtDate(e.createdAt, tz)} {fmtTime(e.createdAt, tz)}
                  {e.reason ? ` · ${data?.reasons[e.reason] ?? e.reason}` : ''}{e.note && e.type !== 'REPLIED' ? ` · «${e.note}»` : ''}</li>
              ))}
            </ul>
          </details>
        </div>
      ))}
    </div>
  );
}

function HideForm({ reasons, onHide }: { reasons: Record<string, string>; onHide: (reason: string, note: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  if (!open) return <button className="danger" onClick={() => setOpen(true)}>Ocultar</button>;
  return (
    <div className="stack card" style={{ flex: 1 }}>
      <label>Motivo<select value={reason} onChange={(e) => setReason(e.target.value)}>
        <option value="">Selecciona…</option>
        {Object.entries(reasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select></label>
      <label>Nota para el paciente (opcional)<input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="row">
        <button className="danger" disabled={!reason} onClick={() => { onHide(reason, note.trim() || null); setOpen(false); }}>Ocultar y avisar</button>
        <button onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </div>
  );
}

function ReplyEditor({ review, canReply, onSave, onRemove }: { review: Review; canReply: boolean; onSave: (text: string) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(review.reply?.text ?? '');
  if (!canReply) return null;
  if (!open) {
    return (
      <>
        <button onClick={() => { setText(review.reply?.text ?? ''); setOpen(true); }}>{review.reply ? 'Editar respuesta' : 'Responder'}</button>
        {review.reply && <button className="ghost" onClick={onRemove}>Retirar respuesta</button>}
      </>
    );
  }
  return (
    <div className="stack card" style={{ flex: 1 }}>
      <label>Respuesta pública<textarea value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Gracias por tu opinión…" /></label>
      <div className="row">
        <button className="primary" disabled={text.trim().length < 2} onClick={() => { onSave(text.trim()); setOpen(false); }}>Publicar respuesta</button>
        <button onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </div>
  );
}
