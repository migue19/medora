'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { StaffSessionData, errorMessage, staffSession } from '@/lib/api';
import { fmtDate, money } from '@/lib/format';

type PlanKey = 'CONSULTORIO' | 'CLINICA' | 'PLUS';
interface PlanInfo { key: PlanKey; name: string; priceCents: number; maxDoctors: number; summary: string[] }
interface Status {
  available: boolean; invoicingAvailable: boolean; plan: PlanKey; status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';
  active: boolean; exempt: boolean; trialEndsAt: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean;
  subscribed: boolean; verification: 'PENDING' | 'VERIFIED' | 'REJECTED'; verificationNote: string | null; activeDoctors: number;
  plans: PlanInfo[]; regimes: Record<string, string>;
  billing: { rfc: string; legalName: string; fiscalRegime: string; zipCode: string; cfdiUse: string; email: string } | null;
  invoices: {
    id: string; plan: PlanKey; amountCents: number; periodStart: string; periodEnd: string; paidAt: string;
    cfdiStatus: 'PENDING' | 'ISSUED' | 'SKIPPED' | 'FAILED'; cfdiUuid: string | null; cfdiError: string | null; canRequest: boolean;
  }[];
}

const TZ = 'America/Mexico_City';
const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)) : null);
const CFDI_LABEL: Record<string, string> = { PENDING: 'Facturando…', ISSUED: 'Facturada', SKIPPED: 'Sin factura', FAILED: 'Error al facturar' };

/** Aviso arriba del panel: prueba por terminar, suscripción vencida o cédula en revisión. */
export function SubscriptionBanner({ onOpen }: { onOpen: () => void }) {
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => { staffSession.get<Status>('/api/clinic/subscription').then(setS).catch(() => undefined); }, []);
  if (!s || s.exempt) return null;
  const left = daysLeft(s.trialEndsAt);
  let text: string | null = null;
  let tone = 'warn';
  if (!s.active) { text = s.status === 'TRIALING' ? 'Tu periodo de prueba terminó: los pacientes ya no pueden reservar en línea.' : 'Tu suscripción no está vigente: los pacientes ya no pueden reservar en línea.'; tone = 'error'; }
  else if (s.status === 'PAST_DUE') text = 'No pudimos cobrar tu suscripción. Actualiza tu tarjeta para no perder las reservas en línea.';
  else if (s.status === 'TRIALING' && !s.subscribed && left !== null && left <= 5) text = `Te quedan ${left} ${left === 1 ? 'día' : 'días'} de prueba.`;
  else if (s.verification === 'PENDING') { text = 'Estamos verificando la cédula profesional (normalmente en un día hábil). Mientras, ya puedes usar Medora.'; tone = ''; }
  else if (s.verification === 'REJECTED') text = `No pudimos verificar la cédula${s.verificationNote ? `: ${s.verificationNote}` : ''}.`;
  if (!text) return null;
  return (
    <div className={`alert ${tone} row`} role="status" style={{ marginBottom: 12 }}>
      <span style={{ flex: 1 }}>{text}</span>
      <button className="small" onClick={onOpen}>Ver suscripción</button>
    </div>
  );
}

export function Subscription({ session }: { session: StaffSessionData }) {
  const owner = session.membership.role === 'OWNER';
  const [s, setS] = useState<Status | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => staffSession.get<Status>('/api/clinic/subscription').then(setS).catch((e) => setMsg({ ok: false, text: errorMessage(e) })), []);
  useEffect(() => {
    void load();
    if (new URLSearchParams(window.location.search).get('pago') === 'listo') {
      setMsg({ ok: true, text: '¡Gracias! Estamos confirmando tu pago con Stripe; en unos segundos verás tu suscripción activa.' });
      window.history.replaceState(null, '', '/panel?tab=suscripcion');
      const t = [3000, 8000].map((ms) => setTimeout(() => { void load(); }, ms));
      return () => t.forEach(clearTimeout);
    }
  }, [load]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true); setMsg(null);
    try { await fn(); if (ok) setMsg({ ok: true, text: ok }); await load(); } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  }
  async function redirect(path: string, body: object) {
    setBusy(true); setMsg(null);
    try { window.location.assign((await staffSession.post<{ url: string }>(path, body)).url); } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); setBusy(false); }
  }
  async function downloadInvoice(id: string, format: 'pdf' | 'xml') {
    try {
      const res = await staffSession.raw('GET', `/api/clinic/subscription/invoices/${id}/${format}`);
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: `factura-medora.${format}` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); }
  }

  if (!s) return <p className="muted">{msg?.text ?? 'Cargando…'}</p>;
  const current = s.plans.find((p) => p.key === s.plan)!;
  const left = daysLeft(s.trialEndsAt);

  return (
    <div className="stack">
      {msg && <div className={`alert ${msg.ok ? 'ok' : 'error'}`} role="status">{msg.text}</div>}
      <div className="card stack" style={{ gap: 6 }}>
        <div className="row">
          <h3 style={{ margin: 0 }}>Plan {s.exempt ? 'Plus' : current.name}</h3>
          {s.exempt ? <span className="badge COMPLETED">Sin costo</span>
            : s.status === 'TRIALING' ? <span className="badge BOOKED">Prueba{left !== null ? ` · ${left} días` : ''}</span>
            : s.status === 'ACTIVE' ? <span className="badge COMPLETED">Activa</span>
            : s.status === 'PAST_DUE' ? <span className="badge NO_SHOW">Pago pendiente</span>
            : <span className="badge CANCELLED">Cancelada</span>}
          {s.verification === 'VERIFIED' ? <span className="badge COMPLETED">Cédula verificada</span> : s.verification === 'PENDING' ? <span className="badge">Cédula en revisión</span> : <span className="badge CANCELLED">Cédula no verificada</span>}
        </div>
        {s.exempt ? <p className="small muted" style={{ margin: 0 }}>Tu clínica tiene Medora con todo incluido, sin costo.</p> : (
          <p className="small muted" style={{ margin: 0 }}>
            {s.status === 'TRIALING' && !s.subscribed && s.trialEndsAt && `Tu prueba termina el ${fmtDate(s.trialEndsAt, TZ)}. Suscríbete antes para no perder las reservas en línea; los días que queden no se cobran.`}
            {s.subscribed && s.currentPeriodEnd && (s.cancelAtPeriodEnd
              ? `Se cancelará el ${fmtDate(s.currentPeriodEnd, TZ)}; hasta entonces todo sigue funcionando.`
              : `Próximo cobro: ${fmtDate(s.currentPeriodEnd, TZ)} · ${money(current.priceCents)} (IVA incluido).`)}
            {' '}{s.activeDoctors} de {current.maxDoctors} {current.maxDoctors === 1 ? 'médico' : 'médicos'} activos.
          </p>
        )}
        {owner && s.subscribed && !s.exempt && (
          <div className="row">
            <button disabled={busy} onClick={() => redirect('/api/clinic/subscription/portal', {})}>Cambiar tarjeta</button>
            <button className="ghost" disabled={busy} onClick={() => {
              if (s.cancelAtPeriodEnd || window.confirm('¿Cancelar la suscripción al final del periodo? Tu información se conserva.')) {
                void run(() => staffSession.post('/api/clinic/subscription/cancel', { cancel: !s.cancelAtPeriodEnd }), s.cancelAtPeriodEnd ? 'Suscripción reactivada.' : 'Se cancelará al final del periodo.');
              }
            }}>{s.cancelAtPeriodEnd ? 'Reactivar suscripción' : 'Cancelar suscripción'}</button>
          </div>
        )}
      </div>

      {!s.exempt && (
        <div className="grid">
          {s.plans.map((p) => {
            const isCurrent = p.key === s.plan;
            return (
              <div key={p.key} className="card stack" style={{ gap: 6, borderColor: isCurrent ? 'var(--primary)' : undefined }}>
                <strong>{p.name}</strong>
                <span><strong style={{ fontSize: '1.4rem' }}>{money(p.priceCents)}</strong> <span className="small muted">al mes, IVA incluido</span></span>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{p.summary.map((x) => <li key={x}>{x}</li>)}</ul>
                {owner && (isCurrent
                  ? (!s.subscribed || s.status === 'CANCELED')
                    ? <button className="primary" disabled={busy || !s.available} onClick={() => redirect('/api/clinic/subscription/checkout', { plan: p.key })}>Suscribirme</button>
                    : <span className="small muted">Tu plan actual</span>
                  : <button disabled={busy} onClick={() => run(() => staffSession.post('/api/clinic/subscription/plan', { plan: p.key }), `Cambiaste al plan ${p.name}.${s.subscribed ? ' Stripe ajusta la diferencia en tu próximo cobro.' : ''}`)}>
                      Cambiar a {p.name}</button>)}
              </div>
            );
          })}
        </div>
      )}
      {!s.available && !s.exempt && <p className="small muted">El cobro en línea de suscripciones aún no está activado en Medora.</p>}

      {!s.exempt && <BillingForm s={s} busy={busy} run={run} />}

      {s.invoices.length > 0 && (
        <div className="card table-wrap">
          <h3>Pagos y facturas</h3>
          <table>
            <thead><tr><th>Fecha</th><th>Plan</th><th>Monto</th><th>Factura</th></tr></thead>
            <tbody>
              {s.invoices.map((i) => (
                <tr key={i.id}>
                  <td className="small">{fmtDate(i.paidAt, TZ, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td className="small">{s.plans.find((p) => p.key === i.plan)?.name}</td>
                  <td className="small">{money(i.amountCents)}</td>
                  <td className="small">
                    {i.cfdiStatus === 'ISSUED' ? (
                      <div className="row"><button className="ghost small" onClick={() => downloadInvoice(i.id, 'pdf')}>PDF</button><button className="ghost small" onClick={() => downloadInvoice(i.id, 'xml')}>XML</button></div>
                    ) : (
                      <>
                        <span className="muted">{CFDI_LABEL[i.cfdiStatus]}{i.cfdiError ? `: ${i.cfdiError}` : ''}</span>
                        {i.canRequest && <button className="ghost small" disabled={busy || !s.billing} onClick={() => run(() => staffSession.post(`/api/clinic/subscription/invoices/${i.id}/cfdi`, {}), 'Generando la factura; te llegará por correo.')}>Facturar</button>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BillingForm({ s, busy, run }: { s: Status; busy: boolean; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(() => staffSession.put('/api/clinic/subscription/billing', {
      rfc: String(f.get('rfc')).toUpperCase().trim(), legalName: f.get('legalName'), fiscalRegime: f.get('fiscalRegime'),
      zipCode: f.get('zipCode'), cfdiUse: f.get('cfdiUse'), email: f.get('email'),
    }), 'Datos fiscales guardados. Tus próximos cobros se facturan automáticamente.');
  }
  return (
    <form className="card stack" onSubmit={save}>
      <h3 style={{ margin: 0 }}>Datos para tu factura (CFDI 4.0)</h3>
      <p className="small muted" style={{ margin: 0 }}>Escríbelos exactamente como en tu Constancia de Situación Fiscal (nombre o razón social sin «S.A. de C.V.»). Cada cobro se factura solo y te llega por correo.</p>
      <div className="grid">
        <label>RFC<input name="rfc" required minLength={12} maxLength={13} defaultValue={s.billing?.rfc ?? ''} autoCapitalize="characters" /></label>
        <label>Nombre o razón social<input name="legalName" required maxLength={254} defaultValue={s.billing?.legalName ?? ''} /></label>
        <label>Régimen fiscal<select name="fiscalRegime" required defaultValue={s.billing?.fiscalRegime ?? ''}>
          <option value="" disabled>Elige…</option>
          {Object.entries(s.regimes).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
        </select></label>
        <label>Código postal fiscal<input name="zipCode" required pattern="\d{5}" maxLength={5} inputMode="numeric" defaultValue={s.billing?.zipCode ?? ''} /></label>
        <label>Uso del CFDI<select name="cfdiUse" defaultValue={s.billing?.cfdiUse ?? 'G03'}>
          <option value="G03">G03 · Gastos en general</option><option value="S01">S01 · Sin efectos fiscales</option>
        </select></label>
        <label>Correo para facturas<input name="email" type="email" required maxLength={254} defaultValue={s.billing?.email ?? ''} /></label>
      </div>
      {!s.invoicingAvailable && <p className="small muted" style={{ margin: 0 }}>La facturación automática se activará pronto; tus datos quedan guardados.</p>}
      <div><button className="primary" disabled={busy}>Guardar datos fiscales</button></div>
    </form>
  );
}
