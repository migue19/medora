'use client';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { errorMessage } from '@/lib/api';
import { money } from '@/lib/format';

interface Plan { key: string; name: string; priceCents: number; maxDoctors: number; summary: string[] }

export function Signup() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [trialDays, setTrialDays] = useState(14);
  const [plan, setPlan] = useState('CLINICA');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('plan');
    if (q) setPlan(q.toUpperCase());
    fetch('/api/public/plans').then((r) => r.json()).then((d) => { setPlans(d.plans); setTrialDays(d.trialDays); }).catch(() => undefined);
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      clinicName: f.get('clinicName'), ownerName: f.get('ownerName'), email: String(f.get('email')).trim(), phone: f.get('phone'), plan,
      doctorName: f.get('doctorName'), specialty: f.get('specialty'), licenseNumber: String(f.get('licenseNumber')).replace(/\D/g, ''),
      acceptTerms: f.get('acceptTerms') === 'on',
    };
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/public/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message ?? `Error ${res.status}`);
      setSentTo(body.email);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  if (sentTo) {
    return (
      <>
        <Header />
        <main className="container narrow section stack">
          <h1>Revisa tu correo</h1>
          <div className="alert ok" role="status">Enviamos a <strong>{sentTo}</strong> el enlace para elegir tu contraseña y entrar al panel.</div>
          <p className="muted">Si no lo ves en unos minutos, revisa la carpeta de spam. Tus {trialDays} días de prueba empiezan hoy y no necesitas tarjeta.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <Header><Link className="btn ghost" href="/login">Ya tengo cuenta</Link></Header>
      <main className="container section stack">
        <div>
          <h1>Registra tu clínica</h1>
          <p className="muted">{trialDays} días gratis, sin tarjeta. Después eliges tu plan; puedes cambiarlo o cancelarlo cuando quieras.</p>
        </div>
        <div className="grid" role="radiogroup" aria-label="Plan">
          {plans.map((p) => (
            <button key={p.key} type="button" role="radio" aria-checked={plan === p.key} onClick={() => setPlan(p.key)}
              className="card stack" style={{ gap: 4, textAlign: 'left', alignItems: 'stretch', borderColor: plan === p.key ? 'var(--primary)' : undefined, borderWidth: plan === p.key ? 2 : 1 }}>
              <strong>{p.name}</strong>
              <span><strong style={{ fontSize: '1.3rem' }}>{money(p.priceCents)}</strong> <span className="small muted">al mes, IVA incluido</span></span>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{p.summary.map((x) => <li key={x}>{x}</li>)}</ul>
            </button>
          ))}
        </div>
        <form className="card stack" onSubmit={submit}>
          <div className="grid">
            <label>Nombre de la clínica o consultorio<input name="clinicName" required minLength={3} maxLength={120} placeholder="Consultorio Dra. Sofía Ramírez" /></label>
            <label>Tu nombre<input name="ownerName" required minLength={3} maxLength={120} autoComplete="name" /></label>
            <label>Correo<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
            <label>Teléfono<input name="phone" required inputMode="tel" pattern="\+?[0-9 \(\)\-]{8,20}" autoComplete="tel" /></label>
          </div>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Médico responsable</h2>
          <p className="small muted" style={{ margin: 0 }}>Verificamos la cédula en el Registro Nacional de Profesionistas de la SEP (normalmente en un día hábil). Mientras, ya puedes configurar tu agenda.</p>
          <div className="grid">
            <label>Nombre como aparecerá<input name="doctorName" required minLength={3} maxLength={120} placeholder="Dra. Sofía Ramírez" /></label>
            <label>Especialidad<input name="specialty" required minLength={3} maxLength={120} placeholder="Pediatría" /></label>
            <label>Cédula profesional<input name="licenseNumber" required inputMode="numeric" pattern="\d{7,8}" maxLength={8} placeholder="7 u 8 dígitos" /></label>
          </div>
          <label className="check"><input type="checkbox" name="acceptTerms" required />Acepto el <Link href="/privacidad" target="_blank">aviso de privacidad</Link> de Medora.</label>
          {error && <div className="alert error" role="alert">{error}</div>}
          <div><button className="primary" disabled={busy}>{busy ? 'Registrando…' : 'Crear mi cuenta'}</button></div>
        </form>
      </main>
    </>
  );
}
