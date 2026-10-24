import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Header } from '@/components/Header';
import { apiBase } from '@/lib/server-api';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Verificación de receta', robots: { index: false, follow: false } };

interface Verified {
  code: string; issuedAt: string; voided: boolean; voidedAt: string | null; clinic: string; patientInitials: string;
  doctor: { name: string; specialty: string; licenseNumber: string | null };
  items: { drug: string; presentation: string; dose: string; route: string; frequency: string; duration: string }[];
}

/** Página que abre el QR de la receta: la farmacia confirma que es auténtica y que no fue anulada. */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let data: Verified | null = null;
  if (/^[A-Za-z0-9]{10}$/.test(code)) {
    const forwarded = (await headers()).get('x-forwarded-for');
    const res = await fetch(`${apiBase()}/api/public/prescriptions/${code}`, {
      cache: 'no-store', headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
    });
    if (res.ok) data = await res.json();
  }
  const when = (iso: string) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(iso));
  return (
    <>
      <Header />
      <main className="container narrow section stack">
        <h1>Verificación de receta</h1>
        {!data ? (
          <div className="alert error" role="alert">No encontramos una receta con el código <strong>{code.toUpperCase()}</strong>. Revisa el código o comunícate con el médico.</div>
        ) : (
          <>
            {data.voided
              ? <div className="alert error" role="alert"><strong>Receta anulada</strong>{data.voidedAt ? ` el ${when(data.voidedAt)}` : ''}. No debe surtirse.</div>
              : <div className="alert ok" role="status"><strong>Receta auténtica</strong>, emitida en Tepahti.</div>}
            <div className="card stack" style={{ gap: 6 }}>
              <span><strong>Folio:</strong> {data.code}</span>
              <span><strong>Fecha:</strong> {when(data.issuedAt)}</span>
              <span><strong>Médico:</strong> {data.doctor.name} · {data.doctor.specialty}{data.doctor.licenseNumber ? ` · Cédula ${data.doctor.licenseNumber}` : ''}</span>
              <span><strong>Clínica:</strong> {data.clinic}</span>
              <span><strong>Paciente:</strong> {data.patientInitials}</span>
            </div>
            <div className="card stack" style={{ gap: 6 }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Medicamentos</h2>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {data.items.map((i, n) => (
                  <li key={n}><strong>{i.drug}</strong>{i.presentation ? ` · ${i.presentation}` : ''}<div className="small muted">{[i.dose, i.route && `vía ${i.route}`, i.frequency, i.duration && `durante ${i.duration}`].filter(Boolean).join(', ')}</div></li>
                ))}
              </ol>
            </div>
            <p className="small muted">Para proteger al paciente, aquí sólo aparecen sus iniciales y los medicamentos; el resto del expediente es confidencial. La cédula se puede consultar en el Registro Nacional de Profesionistas de la SEP.</p>
          </>
        )}
      </main>
    </>
  );
}
