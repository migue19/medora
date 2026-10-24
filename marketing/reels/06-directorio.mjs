// Reel 6 · Directorio: pacientes nuevos encuentran al médico y reservan directo.
import { record } from './lib.mjs';

await record('06-directorio', { patient: true }, async (r) => {
  const { page } = r;
  await r.card('Que nuevos pacientes<br>te encuentren.', 'Aparece en el directorio de Tepahti 👇');

  await r.go('/directorio');
  await r.caption('Buscan por especialidad o <b>padecimiento</b>', 600);
  await r.type(page.getByLabel(/Especialidad, padecimiento o médico/), 'presión alta', 400);
  await r.tap(page.getByRole('button', { name: 'Buscar' }), 300);
  await page.waitForLoadState('networkidle');
  // Si la búsqueda no quedó en la dirección (la página aún se estaba hidratando), se abre directo.
  if (!/[?&]q=/.test(page.url())) await r.go('/directorio?q=' + encodeURIComponent('presión alta'));
  await page.locator('a.slot').first().waitFor();
  await r.scrollTo(page.locator('article').first(), 600);
  await r.caption('Ven precio, <b>opiniones verificadas</b> y el próximo horario libre', 2600);

  await r.caption('Y reservan <b>directo contigo</b>');
  await r.tap(page.locator('a.slot').nth(1), 300);
  await page.getByRole('button', { name: 'Confirmar cita' }).waitFor();
  await r.scrollTo(page.getByRole('button', { name: 'Confirmar cita' }), 700);
  await r.tap(page.getByRole('button', { name: 'Confirmar cita' }), 900);
  await r.scrollTo(page.getByText('¡Tu cita quedó agendada!'), 400);
  await r.caption('<b>Sin comisión</b> por paciente: sólo tu plan mensual', 2600);

  await r.card('Más pacientes nuevos.<br>Cero comisiones.', 'Directorio con opiniones verificadas y reserva en línea.', '14 días gratis · link en el perfil', 3800);
});
