# Resultados de verificación · Sprint 1

Fecha: 15 de octubre de 2026. Entorno: Linux, Node 22.22, PostgreSQL 16 local (las restricciones usadas, `btree_gist`/`tstzrange`/EXCLUDE, son idénticas en 17).

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (API + web) | OK |
| Pruebas unitarias (`npm test`) | 12/12 |
| Pruebas de integración con PostgreSQL real | 16/16 |
| `npm run build` (API + Next.js) | OK |
| Flujo E2E en navegador (Chromium, escritorio y 375 px) | OK |

## Cobertura de integración

- Login del personal: Origin incorrecto (403), credenciales o clínica incorrectas (401), campos extra (400) y cookie HttpOnly/SameSite=Strict/Path restringido.
- Rotación del refresh, reutilización del token anterior (revoca la familia y sus JWT) y logout que invalida el JWT vigente.
- Cambio de contraseña: revoca sesiones y exige la contraseña actual.
- Pacientes: registro, correo duplicado (409), contraseña corta (400), separación de audiencias JWT, refresh y logout.
- Jerarquía de roles en el equipo y revocación de sesiones al desactivar.
- Disponibilidad pública, reserva, reintento idempotente, mismo `requestId` con otro cuerpo (409), horario ocupado y hora fuera de la cuadrícula.
- **6 reservas simultáneas del mismo horario: exactamente 1 éxito y 5 conflictos.**
- **Inserción directa en la base de una cita traslapada: rechazada por la restricción de exclusión.**
- Límite de 3 citas próximas por paciente y clínica.
- Reprogramación (incluye un horario contiguo a la propia cita), expectativa obsoleta (409), cancelación idempotente, aislamiento entre pacientes y auditoría CREATED → RESCHEDULED → CANCELLED.
- Plazo mínimo de cancelación en línea; el personal sí puede cancelar.
- Bloqueos: rechazo si hay citas, ocultan horarios y quitarlos los libera.
- Recepción agenda a un paciente telefónico. Fuera del horario del médico devuelve 409. El mismo paciente con dos médicos a la vez devuelve 409. El médico sólo ve y edita su agenda y no puede registrar asistencia antes de la cita.
- Aislamiento entre clínicas en consulta, cancelación, horarios, médicos y disponibilidad.
- Reservas en línea pausadas.

## Flujo E2E en navegador

Paciente: reserva en `/c/clinica-demo` con registro, confirmación, reprogramación desde `/paciente`. Personal: login, agenda semanal, alta de paciente telefónico, cita nueva, horarios y bloqueos, configuración y restauración de sesión al recargar. Sin errores de JavaScript. El único 401 en consola es el intento esperado de restaurar la sesión sin cookie. Sin desbordamiento horizontal en 375 px. Manifiesto PWA con 3 iconos.

## Límites de esta verificación

- **Docker Compose no se ejecutó**: el entorno de verificación no tiene daemon de Docker. Compose y Dockerfile siguen el mismo patrón probado en Tavixo, pero conviene ejecutar `npm run verify:local` y el arranque con Compose en tu Mac.
- La migración se aplicó con `psql` y Prisma generó el cliente con su motor WASM, porque la descarga de binarios de Prisma estaba bloqueada en este entorno. En tu Mac, `prisma migrate deploy` descarga el motor habitual.
- Las pruebas usaron PostgreSQL 16; Compose usa 17.9.
