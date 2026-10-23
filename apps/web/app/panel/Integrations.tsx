'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { errorMessage, staffSession } from '@/lib/api';
import { fmtDate, fmtTime } from '@/lib/format';

interface Key { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }
interface Endpoint {
  id: string; url: string; events: string[]; active: boolean; failureCount: number; secret: string; createdAt: string;
  deliveries: { id: string; type: string; status: string; attempts: number; responseCode: number | null; lastError: string | null; createdAt: string }[];
}
interface Overview { keys: Key[]; webhooks: Endpoint[]; events: string[] }

const EVENT_LABEL: Record<string, string> = {
  'appointment.created': 'Cita creada', 'appointment.rescheduled': 'Reprogramada', 'appointment.cancelled': 'Cancelada',
  'appointment.completed': 'Atendida', 'appointment.no_show': 'No asistió', 'appointment.confirmed': 'Confirmada por el paciente',
  'appointment.paid': 'Pagada', 'appointment.refunded': 'Reembolsada',
};

/** API pública y webhooks para conectar Medora con otros sistemas (CRM, sitio web, contabilidad). */
export function Integrations({ tz }: { tz: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const load = useCallback(() => staffSession.get<Overview>('/api/clinic/integrations').then(setData).catch((e) => setMsg({ ok: false, text: errorMessage(e) })), []);
  useEffect(() => { void load(); }, [load]);
  async function run(fn: () => Promise<unknown>, ok?: string) {
    setMsg(null);
    try { await fn(); if (ok) setMsg({ ok: true, text: ok }); await load(); } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); }
  }
  const when = (iso: string) => `${fmtDate(iso, tz, { day: 'numeric', month: 'short' })} ${fmtTime(iso, tz)}`;
  const base = typeof window === 'undefined' ? '' : window.location.origin;

  function createKey(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    void run(async () => {
      const k = await staffSession.post<Key & { secret: string }>('/api/clinic/integrations/keys', { name: f.get('name'), scopes: f.get('write') === 'on' ? ['write'] : [] });
      setNewSecret(k.secret);
      form.reset();
    });
  }
  function createEndpoint(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    void run(async () => {
      await staffSession.post('/api/clinic/integrations/webhooks', { url: f.get('url'), events: f.getAll('events') });
      form.reset();
    }, 'Webhook agregado.');
  }

  if (!data) return <p className="muted">{msg?.text ?? 'Cargando…'}</p>;
  return (
    <div className="stack">
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="status">{msg.text}</div>}

      <div className="card stack">
        <h3 style={{ margin: 0 }}>Llaves de la API</h3>
        <p className="small muted" style={{ margin: 0 }}>Para que otro sistema consulte o agende citas de tu clínica. Trátalas como contraseñas: quien tenga la llave ve los datos de contacto de tus pacientes.</p>
        {newSecret && (
          <div className="alert ok stack" style={{ gap: 6 }}>
            <strong>Copia la llave ahora: no se vuelve a mostrar.</strong>
            <code style={{ wordBreak: 'break-all' }}>{newSecret}</code>
            <div className="row"><button className="small" onClick={() => navigator.clipboard.writeText(newSecret)}>Copiar</button><button className="ghost small" onClick={() => setNewSecret(null)}>Listo</button></div>
          </div>
        )}
        <form className="row" onSubmit={createKey}>
          <input name="name" required minLength={2} maxLength={80} placeholder="Nombre (p. ej. Sitio web, CRM)" aria-label="Nombre de la llave" style={{ flex: '1 1 200px' }} />
          <label className="check small"><input type="checkbox" name="write" />También puede agendar y cancelar</label>
          <button className="primary">Crear llave</button>
        </form>
        {data.keys.length > 0 && (
          <div className="table-wrap"><table>
            <thead><tr><th>Nombre</th><th>Llave</th><th>Permisos</th><th>Último uso</th><th /></tr></thead>
            <tbody>{data.keys.map((k) => (
              <tr key={k.id} style={{ opacity: k.revokedAt ? 0.5 : 1 }}>
                <td>{k.name}</td><td><code>{k.prefix}…</code></td>
                <td className="small">{k.scopes.includes('write') ? 'Consultar y agendar' : 'Sólo consultar'}</td>
                <td className="small">{k.revokedAt ? 'Revocada' : k.lastUsedAt ? when(k.lastUsedAt) : 'Nunca'}</td>
                <td>{!k.revokedAt && <button className="ghost small danger" onClick={() => { if (window.confirm(`¿Revocar la llave «${k.name}»? Los sistemas que la usan dejarán de funcionar.`)) void run(() => staffSession.del(`/api/clinic/integrations/keys/${k.id}`), 'Llave revocada.'); }}>Revocar</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="card stack">
        <h3 style={{ margin: 0 }}>Webhooks</h3>
        <p className="small muted" style={{ margin: 0 }}>Medora avisa a tu sistema en cuanto pasa algo con una cita. Cada aviso va firmado: verifica el encabezado <code>Medora-Signature</code> con el secreto del webhook.</p>
        <form className="stack" onSubmit={createEndpoint}>
          <input name="url" type="url" required pattern="https://.*" maxLength={500} placeholder="https://tu-sistema.com/medora" aria-label="URL del webhook" />
          <fieldset className="row" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small">Eventos (si no eliges, todos)</legend>
            {data.events.map((ev) => <label key={ev} className="check small"><input type="checkbox" name="events" value={ev} />{EVENT_LABEL[ev] ?? ev}</label>)}
          </fieldset>
          <div><button className="primary">Agregar webhook</button></div>
        </form>
        {data.webhooks.map((w) => (
          <div key={w.id} className="stack" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div className="row">
              <code style={{ wordBreak: 'break-all' }}>{w.url}</code>
              {w.active ? <span className="badge COMPLETED">Activo</span> : <span className="badge CANCELLED">Pausado</span>}
              {w.failureCount > 0 && <span className="small" style={{ color: 'var(--danger)' }}>{w.failureCount} fallos seguidos</span>}
            </div>
            <span className="small muted">{w.events.map((e) => EVENT_LABEL[e] ?? e).join(' · ')}</span>
            <div className="row">
              <button className="ghost small" onClick={() => setShown(shown === w.id ? null : w.id)}>{shown === w.id ? 'Ocultar secreto' : 'Ver secreto'}</button>
              {shown === w.id && <code className="small" style={{ wordBreak: 'break-all' }}>{w.secret}</code>}
              <button className="ghost small" onClick={() => run(async () => {
                const r = await staffSession.post<{ ok: boolean; status: number | null; error?: string }>(`/api/clinic/integrations/webhooks/${w.id}/ping`, {});
                if (!r.ok) throw new Error(`Tu sistema respondió ${r.status ?? r.error}`);
              }, 'Tu sistema recibió el aviso de prueba.')}>Probar</button>
              <button className="ghost small" onClick={() => run(() => staffSession.patch(`/api/clinic/integrations/webhooks/${w.id}`, { active: !w.active }))}>{w.active ? 'Pausar' : 'Reactivar'}</button>
              <button className="ghost small danger" onClick={() => { if (window.confirm('¿Eliminar este webhook?')) void run(() => staffSession.del(`/api/clinic/integrations/webhooks/${w.id}`)); }}>Eliminar</button>
            </div>
            {w.deliveries.length > 0 && (
              <details className="small"><summary>Últimos envíos</summary>
                <ul style={{ paddingLeft: 18, margin: '6px 0 0' }}>{w.deliveries.map((d) => (
                  <li key={d.id}>{when(d.createdAt)} · {EVENT_LABEL[d.type] ?? d.type} · {d.status === 'DELIVERED' ? 'entregado' : d.status === 'FAILED' ? `falló (${d.lastError ?? d.responseCode}), reintentando` : 'pendiente'}{d.attempts > 1 ? ` · ${d.attempts} intentos` : ''}</li>
                ))}</ul>
              </details>
            )}
          </div>
        ))}
      </div>

      <details className="card">
        <summary><strong>Documentación de la API</strong></summary>
        <div className="stack small" style={{ marginTop: 8 }}>
          <p style={{ margin: 0 }}>Base: <code>{base}/api/v1</code> · Autenticación: <code>Authorization: Bearer mdr_…</code> · Respuestas en JSON; montos en centavos MXN; fechas ISO 8601 en UTC.</p>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li><code>GET /doctors</code>, <code>GET /services</code>, <code>GET /locations</code></li>
            <li><code>GET /availability?doctorId=&amp;serviceId=&amp;from=AAAA-MM-DD&amp;days=7</code></li>
            <li><code>GET /appointments?from=AAAA-MM-DD&amp;to=AAAA-MM-DD</code> (opcional: <code>doctorId</code>, <code>status</code>, <code>updatedSince</code>, <code>page</code>)</li>
            <li><code>GET /appointments/:id</code></li>
            <li><code>POST /appointments</code> (permiso de agendar): <code>{'{ requestId, doctorId, serviceId, startsAt, patient: { name, phone, email? }, notes?, modality? }'}</code>. Repetir el mismo <code>requestId</code> devuelve la misma cita.</li>
            <li><code>POST /appointments/:id/cancel</code>: <code>{'{ reason }'}</code></li>
          </ul>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{`curl ${base}/api/v1/appointments?from=2026-11-01&to=2026-11-30 \\\n  -H "Authorization: Bearer mdr_…"`}</pre>
          <p style={{ margin: 0 }}>Webhook: <code>POST</code> con <code>{'{ id, type, createdAt, data: { appointment } }'}</code>. Firma: <code>Medora-Signature: t=…,v1=…</code>, donde <code>v1 = HMAC-SHA256(secreto, t + "." + cuerpo)</code>. Responde 2xx; si falla, se reintenta con espera creciente.</p>
        </div>
      </details>
    </div>
  );
}
