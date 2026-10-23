import { Header } from '@/components/Header';

export const metadata = { title: 'Aviso de privacidad', robots: { index: false, follow: true } };

/**
 * BORRADOR: aviso de privacidad de Medora (LFPDPPP). Debe revisarlo un abogado antes de usarse con clínicas reales:
 * datos del responsable, finalidades, transferencias, medio para ejercer derechos ARCO y fecha de actualización.
 */
export default function Page() {
  return (
    <>
      <Header />
      <main className="container narrow section stack">
        <h1>Aviso de privacidad</h1>
        <div className="alert warn">Versión preliminar en revisión.</div>
        <p>Medora es una plataforma de agenda médica en línea. Este aviso describe cómo tratamos los datos personales de quienes contratan Medora (clínicas y su personal) y de los pacientes que reservan a través de ella.</p>
        <h2>Datos de las clínicas y su personal</h2>
        <p>Usamos nombre, correo, teléfono, datos profesionales (como la cédula) y datos fiscales para crear y administrar la cuenta, verificar al médico responsable, cobrar la suscripción, emitir facturas y dar soporte. Los pagos con tarjeta los procesa Stripe y las facturas se timbran con un proveedor autorizado por el SAT.</p>
        <h2>Datos de los pacientes</h2>
        <p>Cada clínica es responsable de los datos de sus pacientes, incluidos los datos de salud del expediente clínico. Medora los trata por cuenta de la clínica, sólo para prestar el servicio (agenda, recordatorios, videoconsulta, expediente y recetas), con controles de acceso, cifrado y bitácora de accesos. Para ejercer derechos sobre esos datos, el paciente debe dirigirse a su clínica.</p>
        <h2>Derechos ARCO</h2>
        <p>Puedes solicitar el acceso, la rectificación, la cancelación u oposición respecto de tus datos escribiendo a contacto@nut.com.mx.</p>
      </main>
    </>
  );
}
