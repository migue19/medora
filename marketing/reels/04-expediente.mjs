// Reel 4 · Expediente clínico y receta con QR verificable.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, record, sql } from './lib.mjs';

// Próxima cita del Dr. Morales con un paciente que ya tiene historial en su expediente.
const [[patientId, appointmentId]] = sql(`
  select a."clinicPatientId", a.id from "Appointment" a join "Doctor" d on d.id = a."doctorId"
  where d."displayName" = 'Dr. Andrés Morales' and a.status = 'BOOKED' and a."startsAt" > now()
    and exists (select 1 from "ClinicalNote" n where n."clinicPatientId" = a."clinicPatientId")
  order by a."startsAt" limit 1`);

await record('04-expediente', { staff: true }, async (r) => {
  const { page } = r;
  await r.card('Expediente clínico<br>y recetas, sin papel.', 'Notas, diagnósticos y recetas con QR en minutos 👇');

  await r.go(`/expediente?paciente=${patientId}`);
  await page.getByRole('button', { name: 'Nueva nota de evolución' }).waitFor();
  await r.caption('Todo el historial del paciente <b>en un solo lugar</b>', 1400);
  await r.scrollBy(380, 1200);

  await r.caption('Nota SOAP con <b>signos vitales</b>');
  await r.tap(page.getByRole('button', { name: 'Nueva nota de evolución' }), 500);
  await r.type(page.getByLabel('TA sistólica (mmHg)'), '146', 150);
  await r.type(page.getByLabel('TA diastólica (mmHg)'), '94', 150);
  await r.type(page.getByLabel(/S · Subjetivo/), 'Dolor de cabeza y presión alta en casa.', 200);
  await r.caption('Diagnósticos <b>CIE-10</b> en segundos');
  await r.type(page.getByPlaceholder(/Busca por código o nombre/), 'hiperten', 900);
  await r.tap(page.getByRole('button', { name: /^I10/ }).first(), 500);
  await r.type(page.getByLabel(/P · Plan/), 'Losartán. Control en 4 semanas.', 300);
  await r.caption('Firmada, <b>ya no se puede alterar</b> (NOM-004)');
  await r.tap(page.getByRole('button', { name: 'Guardar y firmar' }), 1500);

  await r.caption('Receta en un toque');
  await r.tap(page.getByRole('button', { name: 'Recetar' }).first(), 500);
  await r.type(page.getByLabel(/Medicamento \(genérico\)/), 'Losartán', 150);
  await r.type(page.getByLabel(/^Dosis/), '1 tableta', 150);
  await r.type(page.getByLabel(/^Frecuencia/), 'cada 24 horas', 150);
  const pdfRes = page.waitForResponse((res) => /\/prescriptions\/[0-9a-f-]+\/pdf$/.test(res.url()));
  const rxRes = page.waitForResponse((res) => res.request().method() === 'POST' && /\/prescriptions$/.test(res.url()));
  const popup = page.waitForEvent('popup');
  await r.tap(page.getByRole('button', { name: 'Emitir e imprimir' }), 300);
  const rx = await (await rxRes).json();
  // Se vuelve a pedir el PDF con la misma autorización (el cuerpo de la respuesta original ya lo consumió la página).
  const res = await pdfRes;
  const pdf = await (await page.request.get(res.url(), { headers: { authorization: res.request().headers().authorization } })).body();
  (await popup).close().catch(() => {});

  // La receta en PDF, tal como la imprime el médico.
  const base = join(ROOT, 'out', 'receta');
  writeFileSync(`${base}.pdf`, pdf);
  execFileSync('pdftoppm', ['-png', '-r', '220', '-singlefile', `${base}.pdf`, base]);
  const png = readFileSync(`${base}.png`).toString('base64');
  rmSync(`${base}.pdf`); rmSync(`${base}.png`);
  // Hoja completa y luego acercamiento al QR (abajo a la izquierda) para que se lea.
  await r.screen(`<style>body{margin:0;background:#3a4746;height:100vh;overflow:hidden;display:flex;align-items:center;justify-content:center}
    .sheet{width:92%;overflow:hidden;background:#fff;border-radius:6px;box-shadow:0 10px 40px rgb(0 0 0/.45)}
    img{display:block;width:100%;transform-origin:8% 88%;animation:zoom 2.2s 1.2s ease-in-out forwards}
    @keyframes zoom{to{transform:scale(2.1)}}</style>
    <div class="sheet"><img src="data:image/png;base64,${png}"></div>`, 300);
  await r.caption('PDF con tu <b>cédula</b> y un <b>código QR</b>', 2800);

  await r.go(`/receta/${rx.code}`);
  await r.caption('La farmacia la <b>verifica</b> escaneando el QR', 3000);

  await r.card('Consultas más ágiles.<br>Recetas verificables.', 'Expediente conforme a la NOM-004, con bitácora de quién lo consulta.', 'medora.nut.com.mx · 14 días gratis', 3800);
});
