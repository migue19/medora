// Reel 1 · Reservas en línea 24/7: el paciente agenda solo y la clínica lo ve en su agenda.
import { record } from './lib.mjs';

await record('01-reservas-en-linea', { patient: true, staff: true }, async (r) => {
  const { page } = r;
  await r.card('¿Tu recepción vive pegada al teléfono?', 'Así agendan tus pacientes con Medora 👇');

  await r.go('/c/clinica-aurora');
  await r.caption('Tus pacientes agendan <b>solos, 24/7</b>', 1600);
  await r.scrollBy(260, 1400);
  await r.caption('Ven médicos, precios y <b>opiniones verificadas</b>', 1800);

  await r.caption('Eligen médico y servicio');
  await r.tap(page.getByRole('button', { name: /Consulta de cardiología/ }), 1000);

  await r.caption('Sólo ven <b>horarios libres de verdad</b>');
  await r.scrollTo(page.getByRole('heading', { name: '2. Elige fecha y hora' }), 1400);
  await r.tap(page.locator('button.slot').nth(2), 900);

  await r.caption('Confirman en un toque');
  const created = page.waitForResponse((res) => res.request().method() === 'POST' && /\/appointments$/.test(res.url()));
  await r.tap(page.getByRole('button', { name: 'Confirmar cita' }), 1200);
  const { appointment } = await (await created).json();
  await r.scrollTo(page.getByText('¡Tu cita quedó agendada!'), 600);
  await r.caption('Y reciben confirmación y <b>recordatorios por WhatsApp y correo</b>', 2600);

  await r.go('/panel');
  const day = new Date(appointment.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  await page.locator('input[type=date]').fill(day);
  await page.getByText('Mariana López').first().waitFor();
  await r.caption('Tú la ves <b>al instante</b> en tu agenda', 600);
  await r.tap(page.getByText('Mariana López').first(), 2600);

  await r.card('Menos llamadas.<br>Más pacientes.', 'Agenda en línea, recordatorios, expediente y cobros en un solo lugar.', 'medora.nut.com.mx · 14 días gratis', 3800);
});
