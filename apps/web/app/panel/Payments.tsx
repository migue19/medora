'use client';
import { useCallback, useEffect, useState } from 'react';
import { errorMessage, staffSession } from '@/lib/api';
import { PAYMENT_LABEL, PAY_METHOD_LABEL, STATUS_LABEL, addDays, fmtDate, fmtTime, money, todayIn } from '@/lib/format';

interface Report {
  timezone: string; available: boolean;
  totals: { chargedCents: number; refundedCents: number; netCents: number; count: number };
  payments: {
    id: string; status: string; method: string | null; amountCents: number; refundedCents: number; createdAt: string;
    paidAt: string | null; refundedAt: string | null; refundReason: string | null; attention: string | null;
    appointment: { id: string; startsAt: string; status: string; serviceName: string; doctorName: string; patientName: string };
  }[];
  overdue: { appointmentId: string; startsAt: string; paymentDueAt: string; patientName: string }[];
}

/** Conciliación: cobros y reembolsos del periodo con su cita, y lo que requiere atención. */
export function Payments() {
  const today = todayIn('America/Mexico_City');
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Report | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => staffSession.get<Report>(`/api/clinic/payments?from=${from}&to=${to}`).then(setData)
    .catch((e) => setMsg({ ok: false, text: errorMessage(e) })), [from, to]);
  useEffect(() => { void load(); }, [load]);

  async function act(path: string, ok: string) {
    setMsg(null);
    try { await staffSession.post(path, {}); setMsg({ ok: true, text: ok }); await load(); } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); }
  }

  const tz = data?.timezone ?? 'America/Mexico_City';
  const attention = data?.payments.filter((p) => p.attention) ?? [];
  return (
    <div className="stack">
      <div className="row">
        <label>Desde<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Hasta<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
      {data && !data.available && <div className="alert warn">Los pagos en línea todavía no están activados en Tepahti.</div>}
      {data && (
        <>
          <div className="grid">
            <div className="card"><div className="small muted">Cobrado</div><strong>{money(data.totals.chargedCents)}</strong><div className="small muted">{data.totals.count} pagos</div></div>
            <div className="card"><div className="small muted">Reembolsado</div><strong>{money(data.totals.refundedCents)}</strong></div>
            <div className="card"><div className="small muted">Neto a transferir a la clínica</div><strong>{money(data.totals.netCents)}</strong></div>
          </div>
          {(attention.length > 0 || data.overdue.length > 0) && (
            <div className="card stack">
              <h3>Requiere atención</h3>
              {attention.map((p) => (
                <div key={p.id} className="row">
                  <span className="small" style={{ flex: 1 }}>{p.appointment.patientName} · {money(p.amountCents)} · {p.attention}</span>
                  <button className="small" onClick={() => act(`/api/clinic/payments/${p.id}/sync`, 'Pago consultado de nuevo en Stripe.')}>Conciliar</button>
                  {p.status === 'REFUND_PENDING' && (
                    <button className="small" onClick={() => { if (window.confirm('¿Ya devolviste este pago por otro medio (p. ej. transferencia)?')) void act(`/api/clinic/payments/${p.id}/manual-refund`, 'Marcado como reembolsado.'); }}>Marcar reembolsado</button>
                  )}
                </div>
              ))}
              {data.overdue.map((o) => (
                <span key={o.appointmentId} className="small">{o.patientName}: apartado vencido desde {fmtTime(o.paymentDueAt, tz)} que aún no se libera (se reintenta solo).</span>
              ))}
            </div>
          )}
          <div className="table-wrap card">
            <table>
              <thead><tr><th>Fecha de pago</th><th>Paciente y cita</th><th>Monto</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {data.payments.length === 0 && <tr><td colSpan={5} className="muted">Sin pagos en el periodo.</td></tr>}
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="small">{p.paidAt ? `${fmtDate(p.paidAt, tz, { day: 'numeric', month: 'short' })} ${fmtTime(p.paidAt, tz)}` : <span className="muted">—</span>}</td>
                    <td className="small">{p.appointment.patientName}<div className="muted">{p.appointment.serviceName} · {p.appointment.doctorName} · {fmtDate(p.appointment.startsAt, tz, { day: 'numeric', month: 'short' })} {fmtTime(p.appointment.startsAt, tz)} · {STATUS_LABEL[p.appointment.status]}</div></td>
                    <td className="small">{money(p.amountCents)}{p.method ? <div className="muted">{PAY_METHOD_LABEL[p.method] ?? p.method}</div> : null}</td>
                    <td className="small"><span className={`badge ${p.status === 'PAID' ? 'PAID' : ''}`}>{PAYMENT_LABEL[p.status]}</span>{p.refundReason && <div className="muted">{p.refundReason}</div>}</td>
                    <td><button className="ghost small" onClick={() => act(`/api/clinic/payments/${p.id}/sync`, 'Pago consultado de nuevo en Stripe.')}>Conciliar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
