export const metadata = { title: 'Sin conexión' };

export default function Offline() {
  return (
    <main className="container narrow section">
      <div className="card stack">
        <h1>Sin conexión</h1>
        <p className="muted">Tepahti necesita internet para consultar y agendar citas. Revisa tu conexión e inténtalo de nuevo.</p>
      </div>
    </main>
  );
}
