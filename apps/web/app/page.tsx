import Link from 'next/link';
import { Header } from '@/components/Header';

export default function Home() {
  return (
    <>
      <Header>
        <Link className="btn ghost" href="/paciente">Mis citas</Link>
        <Link className="btn" href="/login">Acceso clínica</Link>
      </Header>
      <main className="container">
        <section className="hero stack">
          <h1>Agenda médica en línea para tu clínica</h1>
          <p className="muted" style={{ maxWidth: 640 }}>
            Medora permite que tus pacientes reserven, cancelen y reprogramen citas desde su teléfono,
            mientras recepción y médicos ven su agenda en tiempo real, sin dobles reservas.
          </p>
          <div className="row">
            <Link className="btn primary" href="/login">Entrar al panel</Link>
            <Link className="btn" href="/paciente">Soy paciente</Link>
          </div>
        </section>
        <section className="grid section">
          <div className="card"><h3>Reservas 24/7</h3><p className="muted">Cada clínica tiene su página pública con médicos, servicios y horarios disponibles.</p></div>
          <div className="card"><h3>Sin doble agendado</h3><p className="muted">La base de datos impide que dos citas del mismo médico se traslapen, incluso con reservas simultáneas.</p></div>
          <div className="card"><h3>Agenda para recepción</h3><p className="muted">Captura citas por teléfono, reprograma, cancela con motivo y registra asistencia.</p></div>
          <div className="card"><h3>Horarios y bloqueos</h3><p className="muted">Horario semanal por médico, vacaciones y bloqueos que se reflejan al instante.</p></div>
        </section>
      </main>
    </>
  );
}
