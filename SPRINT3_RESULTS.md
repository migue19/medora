# Resultados de verificación · Sprint 3

Fecha: 16 de octubre de 2026. Entorno: macOS, Node 24.20, PostgreSQL 17 local.

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (API + web) | OK |
| Pruebas unitarias (`npm test`) | 16/16 |
| Pruebas de integración con PostgreSQL real | 32/32 (25 anteriores + 7 nuevas) |
| `npm run build` (API + Next.js) | OK |
| Flujo en navegador con la API y la web locales | OK (ver abajo) |

## Qué se entregó

- **Recordatorios configurables por clínica**: activados por defecto a 24 h y 2 h; hasta 3 anticipaciones entre 30 min y 7 días (el panel ofrece 48 h, 24 h, 4 h, 2 h y 1 h). Se programan al reservar o reprogramar y sólo los que todavía caben (una cita a 3 h sólo recibe el de 2 h).
- **Envío seguro**: al salir, cada recordatorio vuelve a leer la cita y no envía nada si se canceló, se reprogramó, ya empezó o la clínica desactivó esa anticipación. Un índice único parcial en la bitácora impide enviar dos veces aunque el trabajo se repita.
- **Correo y WhatsApp**: correo con un botón «Confirmar o cancelar»; WhatsApp por la Cloud API de Meta con plantilla aprobada y botón de URL dinámica, sólo con consentimiento expreso del paciente. Sin credenciales, WhatsApp queda desactivado.
- **Enlace firmado** (`/cita#token`, o `?t=` desde WhatsApp): se puede consultar sin gastarlo; confirmar o cancelar lo gastan (un solo uso); sólo vale para el horario con que se emitió y vence al iniciar la cita. Cancelar respeta el plazo de la clínica, y si la acción falla el enlace no se pierde.
- **Confirmación de asistencia**: `Appointment.confirmedAt` con evento `CONFIRMED` en la auditoría; se reinicia al reprogramar. En la agenda: insignia «Confirmada por el paciente» y estado de cada recordatorio (enviado, falló o no enviado, con el motivo).
- **Consentimiento de WhatsApp**: casilla al registrarse y preferencia en «Mis citas» para pacientes en línea; casilla al registrar fichas telefónicas y `PATCH /api/clinic/patients/:id` para recepción.

## Cobertura de integración nueva

- Programación a 24 h y 2 h con `runAt` exacto; nada sale antes de tiempo; cada uno sale una vez; 5 trabajadores concurrentes sobre un trabajo repetido envían un solo correo; la agenda muestra ambos envíos.
- Confirmación: consulta, Origin ajeno (403), token inválido (400), confirmar (200), reuso (400), estado posterior, evento `CONFIRMED` con el nombre del paciente.
- Cancelación: fuera de plazo devuelve 409 y el enlace sigue sirviendo para confirmar; dentro de plazo cancela, envía el correo de cancelación con el motivo, y los recordatorios de esa cita ya no salen.
- Reprogramación: reinicia la confirmación, el enlace anterior queda marcado como desactualizado (409 al usarlo), los recordatorios del horario anterior no salen y los del nuevo sí.
- Sólo se programan los recordatorios que todavía caben; con recordatorios desactivados no se programa nada.
- WhatsApp: número normalizado a `52…`, parámetros de la plantilla, token válido en el botón, fallo con reintento sin repetir el correo, y «Sin consentimiento» registrado como no enviado.
- Ajustes: anticipaciones inválidas (400), orden guardado, consentimiento de fichas telefónicas y 403 para fichas con cuenta en línea.

## Flujo en navegador

Enlace `/cita?t=…` (formato de WhatsApp): el token desaparece de la URL, se muestra la cita y «Confirmar asistencia» deja la cita como confirmada. En la agenda semanal aparece la insignia «Confirmada por el paciente». En «Clínica» aparece la sección de recordatorios con 24 h y 2 h marcados y WhatsApp deshabilitado por falta de credenciales.

## Pendiente fuera del código

- WhatsApp: cuenta de Meta Business, número, token permanente y plantilla `recordatorio_cita` aprobada (ver README).
- Los recordatorios por correo dependen del SMTP del Sprint 2, que todavía no se probó con un envío real.
