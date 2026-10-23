// Reel 2 · Recordatorios y confirmación de asistencia: menos inasistencias sin que recepción llame.
import { BASE, record, reminderLink } from './lib.mjs';

const link = reminderLink();
const tz = 'America/Mexico_City';
const when = link.startsAt.toLocaleString('es-MX', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const first = link.patient.split(' ')[0];

const PHONE = `
<style>
  body{margin:0;min-height:100vh;background:#e8eeec;font-family:ui-sans-serif,system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;color:#13201f}
  .bar{background:#0f766e;color:#fff;padding:18px 16px 14px;display:flex;align-items:center;gap:12px}
  .bar i{width:40px;height:40px;border-radius:50%;background:#fff;color:#0f766e;display:grid;place-items:center;font-style:normal;font-weight:800}
  .bar b{display:block;font-size:17px}.bar small{opacity:.8}
  .chat{padding:150px 14px 20px}
  .msg{background:#fff;border-radius:4px 16px 16px 16px;padding:14px 14px 10px;max-width:86%;box-shadow:0 1px 2px rgb(0 0 0/.12);
    font-size:16px;line-height:1.4;opacity:0;transform:translateY(10px);animation:in .5s .4s forwards}
  .msg a{color:#0f766e;font-weight:700;word-break:break-all}
  .msg time{display:block;text-align:right;color:#8a9a98;font-size:12px;margin-top:6px}
  @keyframes in{to{opacity:1;transform:none}}
</style>
<div class="bar"><i>CA</i><div><b>Clínica Aurora</b><small>Recordatorio automático</small></div></div>
<div class="chat"><div class="msg">Hola ${first} 👋 Te recordamos tu cita de <b>${link.service}</b> con <b>${link.doctor}</b> el <b>${when.replace(/\.$/, '')}</b>.<br><br>
Confirma o cancela aquí:<br><a id="lnk" href="${BASE}/cita#${link.token}">medora.nut.com.mx/cita/…</a><time>9:00</time></div></div>`;

await record('02-recordatorios', { staff: true }, async (r) => {
  const { page } = r;
  await r.card('¿Pacientes que no llegan?', 'Medora les recuerda y confirma por ti 👇');

  await r.screen(PHONE, 900);
  await r.caption('Recordatorio automático <b>24&nbsp;h y 2&nbsp;h antes</b>', 2200);
  await r.caption('Por <b>WhatsApp y correo</b>, sin que nadie llame', 1800);
  await r.tap(page.locator('#lnk'), 300);

  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Confirmar asistencia' }).waitFor();
  await r.caption('El paciente confirma <b>en un toque</b>', 1400);
  await r.tap(page.getByRole('button', { name: 'Confirmar asistencia' }), 600);
  await page.getByText('Confirmaste tu asistencia').waitFor();
  await r.caption('Y si cancela, el horario <b>se libera solo</b>', 2400);

  await r.go('/panel');
  const day = link.startsAt.toLocaleDateString('en-CA', { timeZone: tz });
  await page.locator('input[type=date]').fill(day);
  await page.getByText('Confirmada por el paciente').first().waitFor();
  await r.caption('Tu agenda muestra <b>quién ya confirmó</b> ✅', 800);
  await r.scrollTo(page.getByText('Confirmada por el paciente').first(), 1800);
  await r.scrollBy(380, 1800);

  await r.card('Menos inasistencias.<br>Más consultas cobradas.', 'Recordatorios por correo en todos los planes y por WhatsApp desde el plan Clínica.', 'medora.nut.com.mx · 14 días gratis', 3800);
});
