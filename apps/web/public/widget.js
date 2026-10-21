/*!
 * Medora · widget «Reservar cita» para el sitio web de la clínica.
 *
 *   <script src="https://medora.nut.com.mx/widget.js" data-clinica="mi-clinica" async></script>
 *
 * Atributos opcionales:
 *   data-medico="dra-ana-lopez"   abre directamente la agenda de un médico
 *   data-texto="Agenda tu cita"   texto del botón
 *   data-posicion="flotante"      botón fijo en la esquina (por omisión, donde se pega el script)
 *   data-color="#0f766e"          color del botón
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) return;
  var clinic = script.getAttribute('data-clinica') || script.getAttribute('data-clinic');
  if (!clinic || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(clinic)) {
    console.warn('[Medora] Falta data-clinica con el identificador de la clínica.');
    return;
  }
  var doctor = script.getAttribute('data-medico') || '';
  if (doctor && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(doctor)) doctor = '';
  var origin = new URL(script.src).origin;
  var path = '/' + clinic + (doctor ? '/' + doctor : '');
  var embedUrl = origin + '/embed' + path;
  var pageUrl = origin + '/c' + path + '?origen=widget';
  var color = /^#[0-9a-fA-F]{3,8}$/.test(script.getAttribute('data-color') || '') ? script.getAttribute('data-color') : '#0f766e';
  var floating = script.getAttribute('data-posicion') === 'flotante';

  // Enlace normal: funciona aunque falle el modal (y abre en otra pestaña con Ctrl/Cmd + clic).
  var button = document.createElement('a');
  button.href = pageUrl;
  button.textContent = script.getAttribute('data-texto') || 'Reservar cita';
  button.setAttribute('role', 'button');
  button.style.cssText = [
    'display:inline-flex', 'align-items:center', 'gap:8px', 'padding:12px 20px', 'border-radius:999px',
    'background:' + color, 'color:#fff', 'font:600 16px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
    'text-decoration:none', 'box-shadow:0 4px 14px rgba(0,0,0,.18)', 'cursor:pointer', 'z-index:2147483000',
  ].concat(floating ? ['position:fixed', 'right:20px', 'bottom:20px'] : []).join(';');

  var overlay = null;
  var lastFocus = null;

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.documentElement.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (lastFocus) lastFocus.focus();
  }

  function onKey(e) { if (e.key === 'Escape') close(); }

  function open(e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // dejar que abra en otra pestaña
    e.preventDefault();
    lastFocus = document.activeElement;
    overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Reservar cita');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:28px 16px 16px;box-sizing:border-box';
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) close(); });

    var box = document.createElement('div');
    box.style.cssText = 'position:relative;width:100%;max-width:880px;height:min(88vh,860px);border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.35)';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Cerrar');
    closeBtn.textContent = '×';
    // Fuera del marco, en la esquina: no tapa nada de la página de reservas.
    closeBtn.style.cssText = 'position:absolute;top:-16px;right:-12px;width:36px;height:36px;border:2px solid #fff;border-radius:50%;background:#1d2530;color:#fff;font:600 20px/1 system-ui,sans-serif;cursor:pointer;z-index:1;box-shadow:0 2px 8px rgba(0,0,0,.4)';
    closeBtn.addEventListener('click', close);

    var frame = document.createElement('iframe');
    frame.src = embedUrl;
    frame.title = 'Reservar cita en línea';
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block;border-radius:14px;background:#fff';
    frame.setAttribute('allow', 'clipboard-write');

    box.appendChild(closeBtn);
    box.appendChild(frame);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    closeBtn.focus();
  }

  button.addEventListener('click', open);
  if (floating) document.body.appendChild(button);
  else script.parentNode.insertBefore(button, script.nextSibling);
})();
