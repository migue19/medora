import Link from 'next/link';
import { Header } from '@/components/Header';
import { apiBase } from '@/lib/server-api';
import { money } from '@/lib/format';

// Se arma al pedirla (los planes vienen de la API, en caché 1 h): no depende de que la API exista al compilar.
export const dynamic = 'force-dynamic';

interface Plan { key: string; name: string; priceCents: number; summary: string[] }

async function plans(): Promise<{ trialDays: number; plans: Plan[] } | null> {
  try {
    const res = await fetch(`${apiBase()}/api/public/plans`, { next: { revalidate: 3600 } });
    return res.ok ? res.json() : null;
  } catch { return null; }
}

export default async function Home() {
  const pricing = await plans();
  return (
    <>
      <Header>
        <Link className="btn ghost" href="/directorio">Buscar médico</Link>
        <Link className="btn ghost" href="/paciente">Mis citas</Link>
        <Link className="btn" href="/login">Acceso clínica</Link>
      </Header>
      <main className="container">
        <section className="hero stack">
          <h1>Agenda médica en línea para tu clínica</h1>
          <p className="muted" style={{ maxWidth: 640 }}>
            Tepahti permite que tus pacientes reserven, cancelen y reprogramen citas desde su teléfono,
            mientras recepción y médicos ven su agenda en tiempo real, sin dobles reservas.
          </p>
          <div className="row">
            <Link className="btn primary" href="/registro">Prueba 14 días gratis</Link>
            <Link className="btn" href="/login">Entrar al panel</Link>
            <Link className="btn" href="/paciente">Soy paciente</Link>
          </div>
        </section>
        <section className="card stack">
          <h2>¿Buscas médico?</h2>
          <p className="muted">Encuentra especialistas por padecimiento o zona, compara precios y opiniones verificadas, y reserva en línea.</p>
          <form action="/directorio" method="get" role="search" className="row">
            <input name="q" aria-label="Especialidad, padecimiento o médico" placeholder="Ej. pediatra, presión alta" style={{ flex: '1 1 240px' }} />
            <button type="submit" className="primary">Buscar</button>
          </form>
        </section>
        {pricing && (
          <section className="stack section" aria-labelledby="planes">
            <h2 id="planes">Planes para tu clínica</h2>
            <p className="muted">{pricing.trialDays} días gratis, sin tarjeta. Precios mensuales con IVA incluido; cambia o cancela cuando quieras.</p>
            <div className="grid">
              {pricing.plans.map((p) => (
                <div key={p.key} className="card stack" style={{ gap: 6 }}>
                  <h3 style={{ margin: 0 }}>{p.name}</h3>
                  <span><strong style={{ fontSize: '1.5rem' }}>{money(p.priceCents)}</strong> <span className="small muted">al mes</span></span>
                  <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{p.summary.map((x) => <li key={x}>{x}</li>)}</ul>
                  <Link className="btn primary" href={`/registro?plan=${p.key.toLowerCase()}`}>Probar {p.name}</Link>
                </div>
              ))}
            </div>
          </section>
        )}
        <section className="grid section">
          <div className="card"><h3>Reservas 24/7</h3><p className="muted">Cada clínica tiene su página pública con médicos, servicios y horarios disponibles.</p></div>
          <div className="card"><h3>Sin doble agendado</h3><p className="muted">La base de datos impide que dos citas del mismo médico se traslapen, incluso con reservas simultáneas.</p></div>
          <div className="card"><h3>Agenda para recepción</h3><p className="muted">Captura citas por teléfono, reprograma, cancela con motivo y registra asistencia.</p></div>
          <div className="card"><h3>Horarios y bloqueos</h3><p className="muted">Horario semanal por médico, vacaciones y bloqueos que se reflejan al instante.</p></div>
        </section>
        <p className="small muted section">¿Dudas sobre cómo funciona? Visita el <Link href="/ayuda">centro de ayuda</Link> · <Link href="/privacidad">Aviso de privacidad</Link></p>
      </main>
    </>
  );
}
