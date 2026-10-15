# Resultados de verificación · Sprint 2

Fecha: 15 de octubre de 2026. Entorno: macOS, Node 24.20, PostgreSQL 17 local.

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (API + web) | OK |
| Pruebas unitarias (`npm test`) | 15/15 |
| Pruebas de integración con PostgreSQL real | 25/25 (16 del Sprint 1 + 9 nuevas) |
| `npm run build` (API + Next.js) | OK |
| Flujo en navegador con la API y la web locales | OK (ver abajo) |

## Qué se entregó

- **Correo transaccional** por SMTP (nodemailer) con plantillas en español, texto plano y HTML con escape. Sin SMTP en desarrollo, los correos se escriben en la bitácora de la API.
- **Cola persistente** en PostgreSQL (`Job`), encolada en la misma transacción que el cambio de negocio, con `dedupeKey`, reintentos con espera exponencial, arrendamiento de 5 min y borrado del cuerpo al completar.
- **Verificación de correo** del paciente: enlace de 24 h y un solo uso; reservar en línea exige correo confirmado; reenvío limitado a 3 por hora.
- **Recuperación de contraseña** para pacientes y personal: enlace de 30 min y un solo uso; `forgot` siempre responde 204; restablecer revoca todas las sesiones e invalida los demás enlaces.
- **Confirmaciones de cita** al crear, reprogramar y cancelar, con `.ics` (UID estable, `SEQUENCE` creciente y `METHOD:CANCEL` al cancelar). Los reintentos idempotentes y las cancelaciones repetidas no envían correos duplicados.
- **Invitaciones al personal** en lugar de contraseña inicial compartida: vigencia de 7 días, reenviar (invalida el enlace anterior), cancelar, y alta de personas que ya tienen cuenta en otra clínica sin tocar su contraseña.
- **Web**: páginas `/verificar`, `/recuperar`, `/restablecer` e `/invitacion`; aviso de correo sin confirmar en la reserva y en «Mis citas»; enlaces «¿Olvidaste tu contraseña?»; pestaña Equipo con invitaciones pendientes.

## Cobertura de integración nueva

- Verificación: reservar sin confirmar devuelve 403; token inválido, vencido o reemplazado devuelve 400; Origin ajeno devuelve 403; abrir el mismo enlace dos veces no falla; reenvío invalida el enlace anterior; 409 si ya está confirmado.
- Recuperación del paciente: correo inexistente responde 204 sin enviar nada; restablecer revoca la sesión, confirma el correo, es de un solo uso e invalida los otros enlaces pendientes.
- Recuperación del personal: un token de paciente no sirve para el personal; contraseña corta devuelve 400; revoca sesiones.
- Invitaciones: correo normalizado, inspección, contraseña obligatoria para cuentas nuevas, un solo uso, reenviar, revocar, vencida, recepción no puede invitar, invitar a un integrante existente devuelve 409, y unión a una segunda clínica conservando la contraseña.
- Citas: confirmación con `.ics`, reintento con el mismo `requestId` sin correo extra, reprogramación con `SEQUENCE:1`, cancelación doble con un solo correo y `METHOD:CANCEL`, y fichas telefónicas con o sin correo.
- Cola: fallo SMTP con reintento posterior, 10 trabajadores concurrentes con 3 correos enviados exactamente una vez, trabajo abandonado retomado al vencer el arrendamiento, abandono tras el máximo de intentos y `dedupeKey` repetida sin duplicar.

## Flujo en navegador

Reserva en `/c/mi-clinica` → registro → aviso «Confirma tu correo» con el botón deshabilitado → enlace de verificación abierto en otra pestaña (el token desaparece de la URL) → «Ya lo confirmé» → cita agendada y correo de confirmación con `.ics`. Invitación aceptada creando contraseña → `/login?clinica=mi-clinica` con la clínica prellenada → panel como Recepción. Recuperación de contraseña del paciente completa. Pestaña Equipo con una invitación pendiente.

Se encontró y corrigió un error: en `/restablecer`, el modo estricto de React ejecutaba el efecto dos veces y la segunda lectura ya no encontraba el token.

## Pendiente fuera del código

- Crear el buzón `no-reply@nut.com.mx` en Hostinger y poner su contraseña en `SMTP_PASSWORD` del `.env` del servidor.
- Los correos no se probaron todavía contra un servidor SMTP real; la primera prueba será en producción.
