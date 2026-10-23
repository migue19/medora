# Resultados de verificación · Sprint 14

Fecha: 22 de octubre de 2026. Entorno: macOS, Node 24, PostgreSQL 17 local; Google Calendar, receptores de webhooks y servicio de push simulados en las pruebas.

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (API + web) | OK |
| Pruebas unitarias | 16/16 |
| Pruebas de integración con PostgreSQL real (base creada desde cero) | 87/87 (83 anteriores + 4 nuevas) |
| Navegador y `curl` (local) | Pestaña «Integraciones»: crear llave (se muestra una vez), consultar médicos y citas con `curl` a través del sitio; sin llave, 401 |
| Google Calendar y Outlook reales | Pendiente: apps OAuth de Google Cloud y Microsoft Entra |

## Qué se entregó

- **Calendarios (Google Calendar y Outlook):**
  - El médico conecta su cuenta en «Mi cuenta» (OAuth). Los tokens se guardan cifrados con AES-256-GCM.
  - Google (canales de notificación) y Microsoft (suscripciones de Graph) avisan de cada cambio, y Medora vuelve a leer de ayer a 90 días adelante. Los avisos juntos se agrupan en 5 s. Cada 15 minutos hay una revisión de respaldo; los canales se renuevan solos antes de vencer.
  - Bloquean la agenda en línea los eventos ocupados, incluidos los de todo el día en la zona de la clínica. No bloquean los marcados como libres, los rechazados ni las citas que escribió Medora.
  - De cada evento sólo se guarda el horario. La agenda del panel muestra «Ocupado en su calendario» sin detalles.
  - Las citas del médico se escriben en su calendario y se actualizan o borran al cambiar. Al conectar se copian las próximas; se puede apagar.
  - Si el proveedor revoca el acceso, la conexión queda «Vuelve a conectar». Al desconectar se quitan los bloqueos.
- **API pública v1:**
  - Llaves por clínica (`mdr_…`) con permiso de sólo consultar o de consultar y agendar. Sólo se guarda su hash, se muestra una vez, se puede revocar, registra su último uso y tiene un límite de 600 peticiones por minuto.
  - Endpoints: médicos, servicios, sedes, disponibilidad, citas (lista con `updatedSince` y páginas, detalle, alta idempotente con `requestId`, cancelación).
  - El paciente se busca por teléfono (los últimos 10 dígitos) o correo, o se crea. Las citas creadas así quedan con origen «api».
- **Webhooks de citas:**
  - Eventos: creada, reprogramada, cancelada, atendida, no asistió, confirmada, pagada y reembolsada.
  - Firma HMAC-SHA256 con marca de tiempo; reintentos con espera creciente; historial de envíos; se pausan tras 50 fallos seguidos; prueba («ping»).
  - Sólo HTTPS a direcciones públicas: se rechazan IPs internas, loopback, link-local y metadatos de la nube.
  - Un disparador en la base encola cada evento de cita en la misma transacción, sin importar desde dónde se creó.
- **Avisos push (PWA):**
  - El personal los activa por dispositivo.
  - El médico y recepción reciben: cita nueva en línea (o pagada), cancelación del paciente y paciente en la sala de videoconsulta (sólo al médico).
  - Las suscripciones vencidas se borran solas. El aviso no lleva información clínica.
- **App nativa:** evaluación en `docs/app-movil.md`. Recomendación: seguir con la PWA y, si se cumplen los disparadores, Capacitor para una app del personal.

## Cobertura de integración nueva

- **API pública:**
  - Sin llave o con llave inválida, 401; la de sólo consultar no agenda (403).
  - Disponibilidad; alta con origen «api», idempotente y que reutiliza al paciente por teléfono con otro formato; empalme da 409.
  - Lista, sincronización incremental y cancelación.
  - Otra clínica no ve la cita (404); una llave revocada da 401.
- **Webhooks:**
  - HTTP, IP interna o evento desconocido dan 400.
  - Ping; firma verificable; carga útil; filtro por evento.
  - Receptor caído: envío fallido, reintento programado y entregado después, visible en el historial.
- **Google Calendar:**
  - Sólo el médico conecta; `state` alterado da error; tokens cifrados; canal de notificación.
  - La cita previa se copia; aviso con token incorrecto ignorado; el aviso válido sincroniza de inmediato.
  - Sólo el evento ocupado bloquea; no se ofrecen ni se aceptan esos horarios (409); el panel muestra el bloque.
  - Cita nueva copiada y cancelada borrada; acceso revocado deja la conexión en error; al desconectar se quitan los bloqueos.
- **Push:**
  - Suscripción sólo HTTPS; cita nueva en línea avisa al médico y a recepción (no al propietario).
  - Cancelación del paciente; la suscripción vencida se borra; la cita agendada por recepción no avisa.
