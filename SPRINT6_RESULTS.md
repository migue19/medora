# Resultados de verificación · Sprint 6

Fecha: 21 de octubre de 2026. Entorno: macOS, Node 24.20, PostgreSQL 17 local, web en modo producción (`next start`).

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (API + web) | OK |
| Pruebas unitarias (`npm test`) | 16/16 |
| Pruebas de integración con PostgreSQL real | 51/51 (47 anteriores + 4 nuevas) |
| `npm run build` (API + Next.js) | OK |
| Lighthouse 13.5 en `/c/mi-clinica` | Rendimiento 99 · Accesibilidad 100 · Buenas prácticas 100 · SEO 100 |
| Lighthouse 13.5 en `/c/mi-clinica/demo-medora` | Rendimiento 99 · Accesibilidad 100 · Buenas prácticas 100 · SEO 100 |
| Reserva con el widget desde otro origen | OK (cita guardada con canal `widget`) |

## Qué se entregó

- **Páginas públicas renderizadas en el servidor**: `/c/<clínica>` y la nueva `/c/<clínica>/<médico>` llegan con todo el contenido en el HTML. Incluyen título, meta descripción, URL canónica, Open Graph, Twitter y JSON-LD de schema.org: `MedicalClinic` (sedes, horarios, especialidades, médicos y acción de reservar) y `Physician` (foto, especialidad, idiomas, rango de precios, servicios, clínica y acción de reservar). El perfil se guarda en caché 60 s y la reserva sigue siendo interactiva.
- **URL legible por médico**: identificador generado del nombre (`Dra. Ana María Núñez` → `ana-maria-nunez`), único por clínica, editable en «Médicos» y estable si cambia el nombre. La migración lo generó para los médicos existentes.
- **`sitemap.xml`** con la portada, las clínicas activas y los médicos con agenda, y **`robots.txt`** que excluye el panel, el portal, la API, el widget y las páginas de enlaces de un solo uso. Ambos se generan al pedirlos con la URL pública configurada.
- **Widget** `widget.js`: botón en línea o flotante, configurable (médico, texto y color), que abre la reserva en un iframe modal, con cierre por Esc, clic fuera o botón. Sin JavaScript es un enlace normal a la página de reservas. Sólo `/embed/*` se puede incrustar; el resto prohíbe el iframe.
- **Dentro del iframe** no hay cookie de sesión (es de un tercero): el paciente inicia sesión ahí y «Ya confirmé mi correo» relee el perfil con el token vigente en lugar de restaurar la sesión.
- **Enlaces para Google Maps e Instagram** con instrucciones, más la página de cada médico, en «Clínica → Compartir y reservar desde otros sitios», junto al código del widget y la vista previa.
- **Canal de origen** en cada reserva en línea (`web`, `widget`, `google`, `instagram`), visible en la agenda como insignia.
- Restaurar la sesión sin cookie responde 204 en vez de 401; así los visitantes anónimos no generan errores en la consola, que era lo que bajaba «buenas prácticas».

## Comprobaciones con el servidor de producción local

- **HTML de `/c/mi-clinica`**: título «Mi Clínica · Citas en línea | Medora», descripción con especialidades y dirección, canónica, `og:*` y `MedicalClinic`, con enlaces rastreables a cada médico.
- **HTML de `/c/mi-clinica/demo-medora`**: `<h1>` con el nombre del médico y `Physician` con idiomas.
- **Cabeceras**: `/c/...` y `/panel` responden `X-Frame-Options: DENY` y `frame-ancestors 'none'`; `/embed/...` responde `frame-ancestors *`.
- **Errores y archivos**: médico inexistente devuelve 404; `robots.txt` y `sitemap.xml` son correctos y `widget.js` se sirve como JavaScript.
- **Widget desde otro sitio**: en `http://127.0.0.1:8099`, otro origen distinto de `localhost:6011`, se mostraron los dos botones. En el modal se eligió servicio, sede y horario, se inició sesión y se confirmó. La cita quedó en la base con `channel = widget` y la sede correcta. El botón de cerrar se movió fuera del marco porque tapaba «Mis citas».

## Pendiente fuera del código

- Dar de alta el sitio en Google Search Console y enviar `https://medora.nut.com.mx/sitemap.xml`.
- Configurar el enlace de reservas en el Perfil de Empresa de Google y el botón «Reservar» de Instagram con los enlaces del panel.
