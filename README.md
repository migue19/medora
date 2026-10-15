# Medora · Sprint 1

Agenda y reservas de citas médicas en línea para clínicas y consultorios (SaaS multi-clínica). Monorepo npm con Next.js 16 / React 19 (PWA), NestJS 11, Prisma 6 y PostgreSQL 17. Node.js 24 LTS recomendado. Mismo stack y criterios de seguridad que Tavixo.

## Alcance del Sprint 1

**Base y autenticación**

- Clínicas independientes (multi-tenant) identificadas por `slug`. `User` es una identidad global del personal; `Membership` la vincula a una clínica con rol `OWNER`, `ADMIN`, `RECEPTION` o `DOCTOR`.
- Login del personal con correo, contraseña y clínica. JWT de acceso de 15 minutos en memoria (nunca en localStorage) y refresh token opaco de 384 bits por 7 días en cookie HttpOnly `SameSite=Strict`, con rotación y detección de reutilización (revoca toda la familia y sus JWT). Logout con revocación.
- Pacientes con cuenta propia (`PatientAccount`): registro público, login, refresh y logout con cookie y audiencia JWT separadas del personal. Un JWT de paciente no sirve en rutas del personal y viceversa.
- Contraseñas con scrypt y sal aleatoria; comparación en tiempo constante; hash ficticio cuando la cuenta no existe. Cambiar la contraseña revoca todas las sesiones y se serializa con el login.
- Los POST de autenticación exigen `Origin` exacto (CSRF). Límite en memoria: 10 logins/min por IP, 5 registros/h por IP y 120 consultas públicas/min por IP.
- Equipo: OWNER gestiona ADMIN/RECEPTION/DOCTOR; ADMIN gestiona RECEPTION/DOCTOR. Nadie modifica su propia membresía ni al propietario. Cambiar rol o estado revoca las sesiones de esa membresía. No hay registro público del personal.

**Agenda y reservas**

- **Servicios**: nombre, duración (5–480 min, múltiplos de 5) y precio en centavos MXN.
- **Médicos**: nombre, especialidad, cédula, presentación, servicios que ofrece y, opcionalmente, un usuario con rol DOCTOR vinculado.
- **Horario semanal** por médico en hora local de la clínica (varios bloques por día, sin traslapes, validado también en PostgreSQL).
- **Bloqueos** (vacaciones, congresos). No se puede bloquear un periodo con citas agendadas: primero se reprograman o cancelan.
- **Disponibilidad**: cada bloque se divide según la duración del servicio. Se excluyen citas vigentes, bloqueos, la anticipación mínima y el horizonte de reserva de la clínica. Respeta la zona horaria (`America/Mexico_City` por defecto) y omite horas inexistentes por horario de verano.
- **Página pública** `/c/<slug>`: médicos, servicios y precios, horarios por semana y confirmación con motivo de consulta.
- **Reserva en línea**: el horario debe coincidir exactamente con uno publicado. Cada paciente puede tener hasta 3 citas próximas por clínica y nunca dos citas simultáneas. El precio, la duración y el nombre del servicio se congelan en la cita.
- **Portal del paciente** `/paciente`: próximas citas e historial en todas sus clínicas, cancelación y reprogramación en línea hasta N horas antes (configurable por clínica, 2 h por defecto).
- **Panel de la clínica** `/panel`: agenda por día o semana y por médico; nueva cita para pacientes telefónicos (búsqueda y alta de ficha); reprogramar; cancelar con motivo; marcar Atendida o No asistió (sólo cuando la cita ya comenzó). El médico ve y gestiona únicamente su agenda.
- **Configuración de la clínica**: datos de contacto, aceptar o pausar reservas en línea, anticipación mínima, horizonte en días, plazo de cancelación y enlace público para compartir.

### Integridad y concurrencia

- **Sin doble agendado**: restricción de exclusión de PostgreSQL (`btree_gist`, `tstzrange`) sobre las citas no canceladas de cada médico. Aunque una escritura se salte la aplicación, la base rechaza el traslape.
- Las escrituras de agenda de un mismo médico (citas, bloqueos y horario) se serializan con un `pg_advisory_xact_lock`.
- **Reintentos idempotentes**: cada reserva lleva un `requestId` UUID. El mismo cuerpo devuelve la misma cita, y otro cuerpo con el mismo `requestId` devuelve 409. La reprogramación usa `expectedStartsAt` para detectar cambios concurrentes y la cancelación repetida no duplica eventos.
- Auditoría `AppointmentEvent`: creación, reprogramación (de → a), cancelación con motivo, atendida y no asistió, con actor y fecha.
- Claves foráneas compuestas `(id, clinicId)` garantizan en PostgreSQL que médico, servicio, paciente y cita pertenezcan a la misma clínica. La API usa sólo la clínica de la sesión: ignora encabezados de tenant y rechaza campos extra.

### Fuera de este sprint

Directorio público entre clínicas, opiniones verificadas, recordatorios por correo, SMS o WhatsApp, videoconsulta, cobro en línea, expediente clínico (NOM-004/NOM-024), aseguradoras, vinculación de fichas telefónicas con cuentas en línea, verificación de correo y recuperación de contraseña, y Google Calendar. No se envían correos ni mensajes en esta entrega.

> Antes de operar con pacientes reales se recomienda publicar un aviso de privacidad conforme a la LFPDPPP. Los datos de salud son datos personales sensibles.

## Estructura

```text
apps/api/          API NestJS, Prisma (schema + migraciones), seed y pruebas
apps/web/          Next.js App Router y PWA
infra/nginx/       vhost de ejemplo (adaptar antes de usar)
scripts/           verificación local con PostgreSQL temporal en Docker
compose.yaml       servicios aislados del proyecto medora
```

## Arranque con Docker Compose (local)

Requisitos: Docker Desktop con Compose v2 y los puertos 6010/6011 libres. Estos puertos no chocan con Tavixo (6000/6001).

```sh
cp .env.example .env
# Editar .env: POSTGRES_PASSWORD (y la misma en DATABASE_URL), JWT_SECRET (openssl rand -base64 48),
# SEED_OWNER_EMAIL y SEED_OWNER_PASSWORD (12+ caracteres). SEED_DEMO_DATA=true para datos de prueba.
docker compose build
docker compose up -d db
docker compose --profile tools run --rm tools npm run db:migrate
docker compose --profile tools run --rm tools npm run db:seed
docker compose up -d api web
docker compose ps
```

- Panel: **http://localhost:6011/login** con el identificador de clínica `SEED_CLINIC_SLUG`, `SEED_OWNER_EMAIL` y tu contraseña.
- Página de reservas: **http://localhost:6011/c/<SEED_CLINIC_SLUG>**.
- Portal del paciente: **http://localhost:6011/paciente**.

PostgreSQL no publica puertos y está en una red Docker `internal`; la web no pertenece a esa red. Compose sólo publica `127.0.0.1:6010 → api` y `127.0.0.1:6011 → web`. Las rutas `/api/*` de la web funcionan como proxy de mismo origen; usa siempre el puerto 6011 en el navegador. Las migraciones y el seed sólo se ejecutan de forma explícita.

```sh
docker compose logs --tail=100 api web db
docker compose stop          # down conserva el volumen; no usar down -v con datos reales
```

## Desarrollo sin Docker

Requisitos: Node 24 y PostgreSQL 17 local (por ejemplo, `brew install postgresql@17`).

```sh
npm ci
cp apps/api/.env.example apps/api/.env      # editar DATABASE_URL, JWT_SECRET y datos del seed
cp apps/web/.env.example apps/web/.env.local
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

La API escucha en 127.0.0.1:6010 y Next en 127.0.0.1:6011. `WEB_ORIGIN` debe coincidir exactamente con el origen que usas (`http://localhost:6011`).

## Rutas de la API

| Método | Ruta | Acceso |
|---|---|---|
| GET | /api/health | Público |
| POST | /api/auth/login · refresh · logout | Personal; Origin (+ cookie en refresh/logout) |
| GET / PATCH | /api/me · /api/me/password | Personal |
| POST | /api/patient/auth/register · login · refresh · logout | Paciente; Origin |
| GET / PATCH | /api/patient/me · /api/patient/me/password | Paciente |
| GET | /api/patient/appointments | Paciente: próximas e historial |
| POST | /api/patient/appointments/:id/cancel · reschedule | Paciente; `startsAt`, `expectedStartsAt` |
| GET | /api/patient/appointments/:id/availability/:fecha | Paciente: horarios para reprogramar |
| GET | /api/public/clinics/:slug | Público: clínica, médicos y servicios |
| GET | /api/public/clinics/:slug/doctors/:id/availability?serviceId&from&days | Público (máx. 14 días) |
| POST | /api/public/clinics/:slug/appointments | Paciente; `requestId`, `doctorId`, `serviceId`, `startsAt`, `notes` |
| GET / PATCH | /api/clinic | Todos / OWNER, ADMIN |
| GET / POST / PATCH | /api/clinic/members | OWNER, ADMIN según jerarquía |
| GET / POST | /api/clinic/patients | OWNER, ADMIN, RECEPTION |
| GET / POST / PATCH | /api/clinic/services | Todos / OWNER, ADMIN |
| GET / POST / PATCH | /api/clinic/doctors | Todos / OWNER, ADMIN |
| PUT | /api/clinic/doctors/:id/schedule | OWNER, ADMIN o el propio médico |
| GET / POST / DELETE | /api/clinic/doctors/:id/time-off | POST/DELETE: OWNER, ADMIN, RECEPTION o el propio médico |
| GET | /api/clinic/doctors/:id/availability | Personal |
| GET | /api/clinic/appointments?from&days&doctorId | Personal (médico: sólo la suya) |
| GET | /api/clinic/appointments/:id | Detalle con eventos |
| POST | /api/clinic/appointments | OWNER, ADMIN, RECEPTION |
| POST | /api/clinic/appointments/:id/cancel · reschedule · outcome | Según rol |

Códigos: 400 entrada inválida, 401 sesión, 403 rol u origen, 404 fuera de la clínica, 409 conflicto (horario ocupado, reintento con otro cuerpo, cambio concurrente), 429 límite. Todas las respuestas llevan `Cache-Control: no-store`.

## Pruebas

```sh
npm run verify:local          # Docker: PostgreSQL 17 temporal, migraciones, typecheck, pruebas y build
```

O manualmente con una base que termine en `_test`:

```sh
npm run db:generate && npm run typecheck && npm test
DATABASE_URL='postgresql://.../medora_test' npm run db:migrate
TEST_DATABASE_URL='postgresql://.../medora_test' npm run test:integration
```

Ver [TEST_RESULTS.md](TEST_RESULTS.md).

## Notas técnicas

- Prisma usa `engineType = "client"` con `@prisma/adapter-pg`: el cliente no necesita binarios nativos del motor de consultas. `prisma migrate` sigue usando el motor de esquema habitual.
- La migración `20261015090000_init` agrega, además del esquema de Prisma, `btree_gist`, la exclusión anti-traslape de citas y de bloques de horario, y CHECKs de rangos (duraciones, precios, slug, minutos). No editar a mano las tablas ni eliminar estas restricciones.
- El límite de peticiones vive en memoria y corresponde a una sola réplica de la API. Antes de escalar horizontalmente, usar almacenamiento compartido.
- La PWA guarda en caché sólo la pantalla de desconexión e iconos; nunca respuestas de `/api` ni páginas con datos privados.

## Siguiente sprint sugerido

Recordatorios por correo y WhatsApp (24 h y 2 h antes) con confirmación de asistencia, verificación de correo y recuperación de contraseña, vinculación de fichas telefónicas con cuentas, y lista de espera.
