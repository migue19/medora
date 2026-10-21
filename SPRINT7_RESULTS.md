# Resultados de verificación · Sprint 7

Fecha: 21 de octubre de 2026. Entorno: macOS, Node 24.20, PostgreSQL 17 local, web en modo producción (`next start`).

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (API + web) | OK |
| Pruebas unitarias (`npm test`) | 16/16 |
| Pruebas de integración con PostgreSQL real | 56/56 (51 anteriores + 5 nuevas) |
| `npm run build` (API + Next.js) | OK |
| Lighthouse 13.5 en `/c/mi-clinica` y en la página del médico con opiniones | Rendimiento 99 · Accesibilidad 100 · Buenas prácticas 100 · SEO 100 |
| Flujo en navegador | OK (ver abajo) |

## Qué se entregó

- **Invitación tras la cita**: al marcar «Atendida» se programa, 2 h después del fin de la cita, un correo con un enlace personal (`/opinion#…`, un solo uso, vigencia de 30 días). Si la clínica tiene WhatsApp y el paciente dio su consentimiento, también sale por WhatsApp con la plantilla `invitacion_opinion`. Se puede desactivar por clínica.
- **Sólo quien fue atendido opina, una vez por cita**: la aplicación lo valida, un índice único lo impone y un disparador de PostgreSQL rechaza cualquier opinión cuya cita no esté atendida, aunque se inserte directo en la base. También se puede opinar desde «Mis citas» sobre la propia cita atendida.
- **Calificación** de puntualidad, trato e instalaciones (1 a 5, con controles accesibles) y comentario opcional. Se publica como «Ana P.» (nombre e inicial del primer apellido) o como «Paciente verificado».
- **Moderación auditada**: propietario y administración ocultan con un motivo de una lista (lenguaje ofensivo, datos personales, publicidad, sin relación u otro) y una nota opcional. La opinión no se borra: queda guardada y se puede volver a publicar. El paciente recibe un correo con el motivo al ocultarla y otro al restaurarla. Cada alta, ocultamiento, restauración y respuesta queda en `ReviewEvent`.
- **Respuesta pública** del médico de la cita, o de propietario o administración (queda el nombre de quien respondió); se puede editar o retirar. Recepción y otros médicos no pueden responder; cada médico ve sólo sus opiniones.
- **Público**: promedio y número de opiniones en las tarjetas de médico. La página del médico muestra el desglose por criterio, las 5 opiniones más recientes en el HTML y «Ver más» paginado. Los datos estructurados incluyen `aggregateRating` y `review` en `Physician`, y `aggregateRating` en los miembros de `MedicalClinic`. La meta descripción agrega «★ 4.3 (1 opinión)».
- **Panel**: pestaña «Opiniones» con filtro, desglose, nombre real del paciente (sólo interno), ocultar o restaurar, responder e historial completo.

## Cobertura de integración nueva

- Nombre público: dos y cuatro palabras, una sola palabra y anónimo.
- Invitación: programada horas después y no al instante; correo con enlace; consulta; validación de calificaciones (400) y de Origin (403); publicación con comentario recortado; enlace de un solo uso; una opinión por cita también desde el portal; marcas del portal; resumen y opiniones en el perfil público sin datos privados.
- Sin cita atendida: cita agendada o con inasistencia (409), sin invitación, cita ajena (404), token inválido (400) e inserción directa rechazada por el disparador; opinión anónima desde el portal.
- Moderación y respuestas: recepción no modera (403); motivo inválido (400); ocultar con aviso al paciente (motivo y nota); ocultar dos veces (409); oculta fuera del público pero guardada; restaurar con aviso; respuesta sólo del médico de la cita (otro médico y recepción, 403); el médico ve sólo sus opiniones; retirar y volver a responder; bitácora `CREATED → HIDDEN → RESTORED → REPLIED → REPLY_REMOVED → REPLIED`; lista pública paginada con respuesta.
- WhatsApp y ajustes: invitación por WhatsApp con la plantilla de opiniones y token válido; con opiniones desactivadas no se programa invitación y el portal responde 403.

## Flujo en navegador

Cita marcada como atendida desde la API, invitación disparada y enlace del correo abierto en `/opinion` (el token desaparece de la URL). Calificación 5/4/4 con comentario y mensaje de agradecimiento. Tras renovarse la caché, la página del médico muestra 4.3 con el desglose y la opinión de «Paciente W.», y el HTML incluye `aggregateRating`, `reviewBody` y la descripción con estrellas. En el panel, como administradora: respuesta pública, ocultamiento con motivo «Publicidad», historial (3) y «Volver a publicar».

## Pendiente fuera del código

- Para invitar por WhatsApp: aprobar la plantilla `invitacion_opinion` en Meta (ver README).
