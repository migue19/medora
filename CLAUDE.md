# Tepahti (antes Medora) · guía para Claude

Agenda, reservas en línea, expediente y cobros para clínicas en México. Producción: https://medora.nut.com.mx (VPS 82.180.139.70, `/opt/medora`).

## Marca

- El producto se llama **Tepahti** (náhuatl, «curar a la gente»); antes se llamaba Medora y el repositorio, las carpetas, los contenedores y la base conservan ese nombre interno.
- Identidad en `marketing/marca/tepahti` (paquete de Open Design: `DESIGN.md`, `tokens.css`, logos). Los colores de la app viven en `apps/web/app/globals.css` y deben coincidir con esos tokens.
- Nunca cambiar identificadores internos con «medora» (emisor y audiencias de los JWT, la llave derivada `medora-calendar-tokens`, cookies): romperían sesiones y datos cifrados.

## Idioma

- Responder **siempre en español**: texto, resúmenes y botones.
- El código, los comentarios, los mensajes de error para el usuario y los commits también van en español (estilo: `Sprint N: tema`).

## Estructura

- Monorepo npm, Node ≥ 22.12.
- `apps/api` contiene la API:
  - NestJS 11 con Prisma 6.19 (`engineType = "client"` + `@prisma/adapter-pg`) sobre PostgreSQL 17.
  - Cada módulo vive en `src/<dominio>/`: appointments, payments, video, records, billing, reports, integrations, etc.
  - El esquema y las migraciones están en `prisma/`.
  - Pruebas en `test/unit` y `test/integration`.
- `apps/web` contiene la web: Next.js 16 (App Router) y React 19, como PWA. `/api/*` es un proxy de mismo origen hacia la API.
- `compose.yaml` define los servicios `db`, `api`, `web` y `tools` (perfil `tools`). Puertos: API 6010, web 6011.
- `scripts/` tiene los scripts de verificación local, respaldo y prueba de restauración.

## Comandos

```sh
npm run typecheck
npm test                    # unitarias de la API
npm run verify:local        # PostgreSQL temporal en Docker + migraciones + typecheck + pruebas + build
TEST_DATABASE_URL=postgresql://…/medora_test npm run test:integration   # la base debe terminar en _test
npm run db:generate         # tras cambiar schema.prisma
```

Antes de dar por terminado un cambio en la API, correr typecheck y las pruebas de integración.

## Convenciones importantes

### Migraciones

- Siempre una migración SQL nueva en `apps/api/prisma/migrations/AAAAMMDDHHMMSS_nombre`. Nunca editar migraciones ya aplicadas.
- Muchas reglas viven en la base y no deben quitarse:
  - exclusión anti-traslape (`btree_gist`) y CHECKs;
  - triggers de inmutabilidad y retención del expediente;
  - trigger `appointment_outbound`;
  - índices únicos parciales de pagos.

### Cola de trabajos

- La tabla `Job` usa `dedupeKey`. Se encola dentro de la misma transacción del negocio.
- Los handlers reciben `now` (el reloj de la cola). No uses `Date.now()` en ellos.

### Fechas

- Se guardan en UTC; la conexión fija `TimeZone=UTC`.
- Se muestran en la zona horaria de la clínica (`clinic.timezone`), con luxon en la API y `lib/format` en la web.

### Planes

- Las funciones de pago se protegen con `assertFeature` y `entitlements()` (`src/billing/plans.ts`).

### Proveedores externos

- Cada proveedor está detrás de una interfaz inyectable, con un doble falso en las pruebas: Stripe, Daily, Facturama, correo, WhatsApp, webhooks, Google/Microsoft Calendar y web push.
- Stripe:
  - Los webhooks se verifican con el cuerpo crudo.
  - En cada evento se vuelve a leer el estado desde Stripe; nunca se confía en el contenido del evento.

### Datos sensibles

- Los adjuntos clínicos se cifran con AES-256-GCM (`RECORDS_ENCRYPTION_KEY`), y los tokens de calendario con una llave derivada.
- Nunca registrar en logs datos de pacientes ni secretos.

### Encabezados de la web

- `Permissions-Policy` se define por ruta en `apps/web/next.config.ts`:
  - `/consulta` permite cámara y micrófono;
  - `/directorio` permite geolocalización.

## Despliegue (sólo cuando el usuario lo pida)

```sh
ssh root@82.180.139.70 /opt/medora/scripts/backup-db.sh
git archive HEAD | ssh root@82.180.139.70 'tar -x -C /opt/medora && cd /opt/medora \
  && docker compose build -q && docker compose --profile tools build -q tools \
  && docker compose --profile tools run --rm -T tools npm run db:migrate </dev/null \
  && docker compose up -d api web'
```

- Se despliega lo que está en el commit (`git archive HEAD`). Primero se hace commit y después el despliegue.
- Las llaves se cargan **por el usuario** con los scripts de `/opt/medora/scripts` (`set-stripe-keys.sh`, `set-daily-key.sh`, `set-facturama.sh`, `set-calendar-keys.sh`). Nunca se piden ni se escriben secretos en el chat.
- El VPS es compartido: no leer `.env` ni datos de otros proyectos.
- `hostinger.txt` contiene el token de la API de Hostinger: está en `.gitignore` y nunca se imprime.

## Notas en Obsidian

- Las notas del proyecto viven en la bóveda Development: `~/Documents/Development/Tepahti/`.
- El índice es `Tepahti.md`, que enlaza a estas notas:
  - `Estado y pendientes`
  - `Sprints`
  - `Arquitectura`
  - `Despliegue y operación`
  - `Proveedores y cuentas`
  - `Decisiones`
  - `Bitácora`
- Al terminar un trabajo relevante:
  - agregar una entrada con la fecha en `Bitácora.md`;
  - marcar o agregar casillas en `Estado y pendientes.md`;
  - anotar cada decisión nueva en `Decisiones.md`.
- En esas notas nunca van llaves, contraseñas ni datos de pacientes.

## Pendientes conocidos

- Sólo se usa el puerto 443; el 80 está cerrado en el firewall de Hostinger.
- El certificado se renueva solo por DNS. `scripts/acme-dns-hook.sh` publica el TXT con la API de Hostinger, y el token está en `/root/.hostinger-dns-token`.
- Monitoreo:
  - `scripts/monitor.sh` corre cada 5 min por cron (`/etc/cron.d/medora-monitor`) y avisa por correo a `MONITOR_EMAIL` o `ONBOARDING_NOTIFY_EMAIL`.
  - `.github/workflows/disponibilidad.yml` revisa desde fuera cada 15 min.
- Respaldos: copia diaria cifrada en Google Drive con `scripts/offsite-backup.sh`. La contraseña de cifrado está en `/root/medora-offsite-password`.
- Facturama, Stripe en modo real, Microsoft Entra y las plantillas de WhatsApp están pendientes de las cuentas del usuario.
