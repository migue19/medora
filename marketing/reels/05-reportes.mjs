// Reel 5 · Reportes: ocupación, inasistencias, ingresos y origen de las citas.
import { record } from './lib.mjs';

await record('05-reportes', { staff: true }, async (r) => {
  const { page } = r;
  await r.card('¿Sabes cuánto te cuestan<br>las citas perdidas?', 'Tepahti te lo dice en tiempo real 👇');

  await r.go('/panel?tab=reportes');
  await page.getByText('Ocupación de la agenda').waitFor();
  await r.caption('Tus números del mes, <b>sin Excel</b>', 600);
  await r.tap(page.getByRole('button', { name: 'Este mes' }), 1200);
  await r.scrollTo(page.getByText('Ocupación de la agenda'), 600);
  await r.caption('Ocupación, inasistencias e <b>ingresos</b>', 2200);
  await r.scrollTo(page.getByRole('heading', { name: 'Origen de las citas' }), 600);
  await r.caption('De dónde llegan tus pacientes: <b>en línea o por teléfono</b>', 2400);
  await r.scrollTo(page.getByRole('heading', { name: 'Por médico' }), 600);
  await r.caption('Y cómo va <b>cada médico</b>', 2400);
  await r.caption('Además, cada lunes te llega <b>el resumen por correo</b> 📩', 2400);

  await r.card('Decide con datos,<br>no con corazonadas.', 'Reportes incluidos en todos los planes. Exporta a Excel con el plan Plus.', '14 días gratis · link en el perfil', 3800);
});
