// Utilidades para grabar reels verticales (1080×1920) de Tepahti con Playwright contra la demo local.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import * as nodeCrypto from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');
export const BASE = process.env.MEDORA_URL ?? 'http://localhost:6011';
export const creds = () => JSON.parse(readFileSync(join(ROOT, '.demo-credentials.json'), 'utf8'));

// 405×720 CSS px con escala 8/3 = 1080×1920 px reales.
const VIEWPORT = { width: 405, height: 720 };
const SCALE = 8 / 3;
const BRAND = { primary: '#0b6e5f', strong: '#09594d', soft: '#eef6f3', ink: '#15211f', leaf: '#7ddbb8' };
// Logotipo de Tepahti (marketing/marca/tepahti/assets) incrustado en las tarjetas.
const MARK_WHITE = readFileSync(join(here, '../marca/tepahti/assets/mark-white.svg'), 'utf8');

const OVERLAY = `
(() => {
  if (window.__reel) return;
  const css = \`
    #reel-cap{position:fixed;left:16px;right:16px;top:64px;z-index:2147483646;display:flex;justify-content:center;pointer-events:none}
    #reel-cap span{background:${BRAND.ink}ee;color:#fff;font:800 25px/1.18 'Plus Jakarta Sans',ui-sans-serif,system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;
      padding:12px 18px;border-radius:16px;text-align:center;box-shadow:0 8px 30px rgb(0 0 0/.25);letter-spacing:-.01em;
      transform:translateY(-12px) scale(.96);opacity:0;transition:all .35s cubic-bezier(.2,.8,.2,1)}
    #reel-cap span.on{transform:none;opacity:1}
    #reel-cap b{color:${BRAND.leaf}}
    .reel-tap{position:fixed;z-index:2147483647;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;
      background:${BRAND.primary}55;border:3px solid ${BRAND.primary};pointer-events:none;animation:reel-tap .6s ease-out forwards}
    @keyframes reel-tap{0%{transform:scale(.4);opacity:1}100%{transform:scale(1.6);opacity:0}}
    html{scroll-behavior:smooth}
    nextjs-portal{display:none!important}\`;
  // setContent reemplaza el documento pero conserva window: se vuelve a montar cuando falta.
  const mount = () => {
    if (document.getElementById('reel-cap')) return;
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    const cap = document.createElement('div'); cap.id = 'reel-cap'; document.body.appendChild(cap);
  };
  window.__reel = {
    caption(html) {
      mount();
      const cap = document.getElementById('reel-cap');
      cap.innerHTML = html ? '<span>' + html + '</span>' : '';
      const s = cap.querySelector('span'); if (s) requestAnimationFrame(() => requestAnimationFrame(() => s.classList.add('on')));
    },
    tap(x, y) { const d = document.createElement('div'); d.className = 'reel-tap'; d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d); setTimeout(() => d.remove(), 700); },
  };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();`;

const CARD = (title, sub, small) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;800&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;height:100%}
  body{display:flex;flex-direction:column;justify-content:center;gap:22px;padding:0 30px;box-sizing:border-box;color:#fff;
    font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;
    background:radial-gradient(120% 80% at 20% 10%,#1e8f7b 0%,${BRAND.primary} 45%,#0a3f37 100%)}
  .logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:34px;letter-spacing:-.04em;opacity:0;animation:in .5s .1s forwards}
  .logo svg{width:52px;height:52px}
  h1{margin:0;font-size:44px;line-height:1.05;letter-spacing:-.03em;opacity:0;animation:in .6s .35s forwards}
  p{margin:0;font-size:22px;line-height:1.3;opacity:0;animation:in .6s .8s forwards;color:#d7f1ea}
  small{font-size:17px;opacity:0;animation:in .6s 1.2s forwards;color:#a8e3d3}
  @keyframes in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
</style></head><body>
<div class="logo">${MARK_WHITE}tepahti</div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}${small ? `<small>${small}</small>` : ''}
</body></html>`;

export async function login(page, { patient, staff }) {
  const c = creds();
  if (patient) {
    await page.goto(`${BASE}/paciente`);
    await page.getByLabel('Correo electrónico').fill(c.patient.email);
    await page.locator('input[name=password]').fill(c.patient.password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForLoadState('networkidle');
  }
  if (staff) {
    await page.goto(`${BASE}/login`);
    const slug = page.getByLabel(/identificador|clínica/i).first();
    if (await slug.count()) await slug.fill(c.clinicSlug);
    await page.getByLabel(/correo/i).first().fill(c.email);
    await page.locator('input[name=password]').fill(c.password);
    await page.getByRole('button', { name: /entrar|iniciar/i }).click();
    await page.waitForURL(/panel/);
  }
}

/** Graba un reel: `script(reel)` dirige la página; deja el MP4 en marketing/out/<name>.mp4. */
export async function record(name, { patient = false, staff = false, colorScheme = 'light' }, script) {
  const out = join(ROOT, 'out');
  const tmp = join(out, `.tmp-${name}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const browser = await chromium.launch();
  const device = { viewport: VIEWPORT, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true, locale: 'es-MX', timezoneId: 'America/Mexico_City', colorScheme };

  // Sesiones listas antes de grabar, para que el video no muestre inicios de sesión.
  const setup = await browser.newContext(device);
  await login(await setup.newPage(), { patient, staff });
  const storageState = await setup.storageState();
  await setup.close();

  const context = await browser.newContext({ ...device, storageState });
  await context.addInitScript(OVERLAY);
  const page = await context.newPage();

  // Captura nativa del navegador (CDP screencast) a resolución real: cuadros JPEG con su marca de tiempo.
  const frames = [];
  let recording = false;
  let start = 0;
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    if (recording) {
      const file = join(tmp, `f${String(frames.length).padStart(5, '0')}.jpg`);
      writeFileSync(file, Buffer.from(data, 'base64'));
      frames.push({ file, t: metadata.timestamp });
    }
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1 });
  const begin = () => { if (!recording) { recording = true; start = Date.now() / 1000; } };

  const reel = {
    page,
    async card(title, sub, small, ms = 2800) {
      await page.setContent(CARD(title, sub, small));
      begin();
      await page.waitForTimeout(ms);
    },
    /** Pantalla propia (por ejemplo, el mensaje de recordatorio en el celular). */
    async screen(html, ms = 0) {
      await page.setContent(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body>${html}</body></html>`);
      begin();
      if (ms) await page.waitForTimeout(ms);
    },
    async go(path) {
      await page.goto(BASE + path);
      await page.waitForLoadState('networkidle');
      begin();
    },
    async caption(html, ms = 0) { await page.evaluate((h) => window.__reel.caption(h), html); if (ms) await page.waitForTimeout(ms); },
    async wait(ms) { await page.waitForTimeout(ms); },
    async scrollTo(locator, ms = 900) {
      await locator.evaluate((el) => {
        const y = el.getBoundingClientRect().top + window.scrollY - 170;
        window.scrollTo({ top: y, behavior: 'smooth' });
      });
      await page.waitForTimeout(ms);
    },
    async scrollBy(y, ms = 900) { await page.evaluate((dy) => window.scrollBy({ top: dy, behavior: 'smooth' }), y); await page.waitForTimeout(ms); },
    /** Escribe como una persona, letra por letra. */
    async type(locator, text, ms = 500) {
      await reel.tap(locator, 200);
      await locator.pressSequentially(text, { delay: 85 });
      await page.waitForTimeout(ms);
    },
    /** Elige una opción de un <select> mostrando el toque (el menú nativo no aparece en la grabación). */
    async choose(locator, label, ms = 700) {
      await reel.scrollTo(locator, 500);
      const box = await locator.boundingBox();
      await page.evaluate(([x, y]) => window.__reel.tap(x, y), [box.x + box.width / 2, box.y + box.height / 2]);
      await page.waitForTimeout(300);
      // Acepta el texto completo o el inicio de la opción («Dra. Sofía Ramírez» → «Dra. Sofía Ramírez · Pediatría»).
      const value = await locator.evaluate((el, l) => [...el.options].find((o) => o.label === l || o.label.startsWith(l))?.value, label);
      await locator.selectOption(value);
      await page.waitForTimeout(ms);
    },
    async tap(locator, ms = 700) {
      await reel.scrollTo(locator, 700);
      const box = await locator.boundingBox();
      await page.evaluate(([x, y]) => window.__reel.tap(x, y), [box.x + box.width / 2, box.y + box.height / 2]);
      await page.waitForTimeout(250);
      await locator.click();
      await page.waitForTimeout(ms);
    },
  };

  let end = 0;
  try {
    await script(reel).catch(async (e) => {
      await page.screenshot({ path: join(out, `error-${name}.png`) }).catch(() => {});
      throw e;
    });
    end = Date.now() / 1000;
    await page.waitForTimeout(300);
  } finally {
    recording = false;
    await cdp.send('Page.stopScreencast').catch(() => {});
    await context.close();
    await browser.close();
  }
  // Cada cuadro dura hasta el siguiente (el screencast sólo emite cuando cambia la pantalla).
  const list = frames.map((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : end;
    return `file '${f.file}'\nduration ${Math.max(next - f.t, 0.001).toFixed(4)}`;
  });
  list.push(`file '${frames.at(-1).file}'`);
  writeFileSync(join(tmp, 'frames.txt'), list.join('\n'));
  const mp4 = join(out, `${name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'frames.txt'),
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=white,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', '-an', mp4]);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`Listo: ${mp4}`);
  return mp4;
}

// ---------------------------------------------------------------- datos de la demo local

/** Consulta la base local de la demo (contenedor medora-dev); devuelve filas como arreglos de texto. */
export function sql(query) {
  const outp = execFileSync('docker', ['exec', '-i', 'medora-dev', 'psql', '-U', 'postgres', '-d', 'medora_dev', '-AtF', '\t', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
  return outp.trim().split('\n').filter(Boolean).map((l) => l.split('\t'));
}

/** Crea el enlace de un recordatorio (como el que manda Tepahti) para la primera cita sin confirmar del día siguiente hábil. */
export function reminderLink() {
  const { createHash, randomBytes } = nodeCrypto;
  const [row] = sql(`
    select a.id, a."startsAt", p.name, d."displayName", a."serviceName"
    from "Appointment" a join "ClinicPatient" p on p.id = a."clinicPatientId" join "Doctor" d on d.id = a."doctorId"
    where a.status = 'BOOKED' and a."confirmedAt" is null and a."startsAt" > now() + interval '12 hours'
    order by a."startsAt" limit 1`);
  const [id, startsAt, patient, doctor, service] = row;
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  sql(`insert into "AppointmentActionToken" (id, "appointmentId", "tokenHash", "startsAt", "expiresAt")
       values (gen_random_uuid(), '${id}', '${hash}', '${startsAt}', '${startsAt}')`);
  return { token, startsAt: new Date(startsAt.replace(' ', 'T').replace(/\+00$/, 'Z')), patient, doctor, service };
}

/** Siguiente día hábil (lunes a viernes) en formato AAAA-MM-DD, en la zona de la clínica. */
export function nextWeekday(fromDays = 1) {
  const d = new Date(Date.now() + fromDays * 86_400_000);
  while (['Sat', 'Sun'].includes(d.toLocaleDateString('en-US', { timeZone: 'America/Mexico_City', weekday: 'short' }))) d.setTime(d.getTime() + 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}
