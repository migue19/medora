// Capturas del centro de ayuda (/ayuda) tomadas de la clínica demo local. Las deja en apps/web/public/ayuda/*.jpg.
// Uso: node ayuda/capturas.mjs   (con la API y la web locales corriendo y la demo recién creada)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, ROOT, login, nextWeekday, reminderLink, sql } from '../reels/lib.mjs';

const OUT = join(ROOT, '..', 'apps', 'web', 'public', 'ayuda');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const common = { locale: 'es-MX', timezoneId: 'America/Mexico_City', colorScheme: 'light' };
const desktop = await browser.newContext({ ...common, viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1.5 });
const mobile = await browser.newContext({ ...common, viewport: { width: 390, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await login(await desktop.newPage(), { staff: true });
await login(await mobile.newPage(), { patient: true });

async function shot(page, name, { top, wait } = {}) {
  if (wait) await wait.waitFor();
  if (top) await top.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90));
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 74 });
  console.log(`✓ ${name}`);
}
async function open(page, path) {
  await page.goto(BASE + path);
  await page.waitForLoadState('networkidle');
}

const d = await desktop.newPage();
await open(d, '/panel');
await d.locator('input[type=date]').fill(nextWeekday());
await shot(d, 'agenda', { wait: d.getByText('Expediente clínico').first() });

await d.getByRole('button', { name: 'Nueva cita' }).click();
await d.getByLabel('Buscar paciente').fill('Laura');
await d.getByRole('button', { name: /^Laura/ }).first().click();
const sel = (label) => d.locator('label', { hasText: new RegExp(`^${label}`) }).locator('select');
await sel('Médico').selectOption({ index: 1 });
await sel('Servicio').selectOption({ index: 1 });
await shot(d, 'nueva-cita', { top: d.getByRole('heading', { name: 'Nueva cita' }), wait: d.locator('button.slot').first() });

for (const [tab, name, heading] of [
  ['doctors', 'medicos', null], ['services', 'servicios', null], ['team', 'equipo', null],
  ['patients', 'pacientes', null], ['reviews', 'opiniones', null], ['reportes', 'reportes', null], ['integraciones', 'integraciones', null],
]) {
  await open(d, `/panel?tab=${tab}`);
  await d.waitForTimeout(600);
  await shot(d, name, heading ? { top: d.getByRole('heading', { name: heading }) } : {});
}
await open(d, '/panel?tab=clinic');
await shot(d, 'recordatorios', { top: d.getByRole('heading', { name: 'Recordatorios a pacientes' }) });
await shot(d, 'compartir', { top: d.getByRole('heading', { name: 'Compartir y reservar desde otros sitios' }) });

await open(d, '/panel?tab=doctors');
await d.getByRole('button', { name: 'Editar' }).first().click();
await shot(d, 'medico-editar', { top: d.getByText('Nombre a mostrar').first() });

const [[patientId]] = sql(`select n."clinicPatientId" from "ClinicalNote" n order by n."createdAt" desc limit 1`);
await open(d, `/expediente?paciente=${patientId}`);
await shot(d, 'expediente', { wait: d.getByRole('button', { name: 'Nueva nota de evolución' }) });
await d.getByRole('button', { name: 'Nueva nota de evolución' }).click();
await d.getByLabel('TA sistólica (mmHg)').fill('138');
await d.getByLabel('TA diastólica (mmHg)').fill('88');
await d.getByLabel('Frec. cardiaca (lpm)').fill('76');
await d.getByLabel('Peso (kg)').fill('78');
await d.getByLabel(/S · Subjetivo/).fill('Acude a revisión. Refiere cefalea ocasional y cifras de presión elevadas en casa.');
await d.getByLabel(/O · Objetivo/).fill('Consciente, orientado. Ruidos cardiacos rítmicos, sin soplos.');
await d.getByLabel(/A · Análisis/).fill('Hipertensión arterial en control.');
await d.getByLabel(/P · Plan/).fill('Dieta baja en sodio y caminar 30 minutos diarios. Control en 1 mes.');
await d.getByPlaceholder(/Busca por código o nombre/).fill('hiperten');
await d.getByRole('button', { name: /^I10/ }).first().click();
await shot(d, 'nota-soap', { top: d.getByRole('heading', { name: 'Nueva nota de evolución' }) });

const m = await mobile.newPage();
await open(m, '/c/clinica-aurora');
await shot(m, 'pagina-reservas');
await m.getByRole('button', { name: /Consulta de cardiología/ }).click();
await shot(m, 'reservar-horario', { top: m.getByRole('heading', { name: '2. Elige fecha y hora' }), wait: m.locator('button.slot').first() });
await open(m, '/directorio?q=' + encodeURIComponent('presión alta'));
await shot(m, 'directorio', { top: m.locator('article').first() });
await open(m, '/paciente');
await shot(m, 'portal-paciente');
const link = reminderLink();
await open(m, `/cita#${link.token}`);
await shot(m, 'confirmar-cita', { wait: m.getByRole('button', { name: 'Confirmar asistencia' }) });

await browser.close();
