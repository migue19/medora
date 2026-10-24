// Reel 3 · La agenda de la clínica en el celular y una cita por teléfono en segundos.
import { nextWeekday, record } from './lib.mjs';

await record('03-agenda', { staff: true }, async (r) => {
  const { page } = r;
  await r.card('Tu clínica completa,<br>en tu celular.', 'Agenda, pacientes y médicos en un solo lugar 👇');

  await r.go('/panel');
  await page.locator('input[type=date]').fill(nextWeekday());
  await page.getByText('Expediente clínico').first().waitFor();
  await r.caption('Todas las citas del día <b>de un vistazo</b>', 1400);
  await r.scrollBy(420, 1300);
  await r.scrollBy(420, 1300);

  await r.scrollBy(-2000, 900);
  await r.caption('¿Te llaman por teléfono? <b>Agenda en segundos</b>');
  await r.tap(page.getByRole('button', { name: 'Nueva cita' }), 700);
  await r.type(page.getByLabel('Buscar paciente'), 'Carlos', 900);
  await r.tap(page.getByRole('button', { name: /Carlos Fernández/ }).first(), 700);
  await r.choose(page.locator('label', { hasText: /^Médico/ }).locator('select'), 'Dra. Sofía Ramírez');
  await r.choose(page.locator('label', { hasText: /^Servicio/ }).locator('select'), 'Consulta pediátrica', 1000);
  await r.caption('Sólo aparecen <b>horarios libres</b>: cero empalmes');
  await r.tap(page.locator('button.slot').nth(1), 800);
  await r.tap(page.getByRole('button', { name: 'Agendar cita' }), 1500);
  await r.caption('Y el paciente recibe su <b>confirmación al instante</b>', 2600);

  await r.card('Adiós libreta.<br>Adiós empalmes.', 'Agenda en línea y por teléfono, con recordatorios automáticos.', '14 días gratis · link en el perfil', 3800);
});
