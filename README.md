# Medora · Sprint 6

Agenda y reservas de citas médicas en línea para clínicas y consultorios (SaaS multi-clínica). Monorepo npm con Next.js 16 / React 19 (PWA), NestJS 11, Prisma 6 y PostgreSQL 17. Node.js 24 LTS recomendado. Mismo stack y criterios de seguridad que Tavixo.

## Plan por sprints

Objetivo: llegar a la funcionalidad de una plataforma tipo Doctoralia sobre una base SaaS para clínicas. Primero se consolida la operación de cada clínica (sprints 1 a 5). Después vienen la captación de pacientes, los pagos y la telemedicina (6 a 9) y por último el expediente, la facturación y las integraciones (10 a 14). Cada sprint deja una versión desplegable, con migraciones aditivas, pruebas de integración y su propio `SPRINTn_RESULTS.md`.

| Sprint | Tema | Estado |
|---|---|---|
| 1 | Base, autenticación, agenda y reservas en línea | ✅ Entregado |
| 2 | Correo, verificación de cuenta y recuperación de contraseña | ✅ Entregado |
| 3 | Recordatorios y confirmación de asistencia (WhatsApp y correo) | ✅ Entregado |
| 4 | Ficha del paciente, vinculación de cuentas y lista de espera | ✅ Entregado |
| 5 | Sedes, consultorios y perfil profesional completo | ✅ Entregado |
| 6 | Perfil público, SEO y widget de reservas | ✅ Entregado |
| 7 | Opiniones verificadas | Pendiente |
| 8 | Directorio público y búsqueda de médicos | Pendiente |
| 9 | Pagos en línea y políticas de inasistencia | Pendiente |
| 10 | Telemedicina (videoconsulta) | Pendiente |
| 11 | Expediente clínico electrónico y recetas | Pendiente |
| 12 | Suscripciones SaaS y facturación CFDI 4.0 | Pendiente |
| 13 | Reportes y analítica | Pendiente |
| 14 | Integraciones: calendarios, API pública y notificaciones push | Pendiente |

### Sprint 1 · Base y agenda ✅

Clínicas multi-tenant, roles OWNER/ADMIN/RECEPTION/DOCTOR, autenticación con refresh rotativo para el personal y para pacientes, servicios, médicos, horario semanal, bloqueos, disponibilidad, página pública de reservas, portal del paciente, panel de agenda, citas por teléfono, reprogramación, cancelación y asistencia. PostgreSQL impide el doble agendado. Detalle en [Alcance del Sprint 1](#alcance-del-sprint-1).

### Sprint 2 · Correo y cuentas ✅

Entregado como se planeó, con un cambio: en lugar de pg-boss, la cola es una tabla propia (`Job`) que se escribe **en la misma transacción** que el cambio de negocio. Así un correo existe si y sólo si la cita, el registro o la invitación se confirmaron (pg-boss usa su propia conexión y no puede participar en la transacción de Prisma). El trabajador reclama trabajos con `FOR UPDATE SKIP LOCKED` y un arrendamiento de 5 minutos, reintenta con espera exponencial (30 s → 1 h, 8 intentos) y, al terminar, borra el cuerpo del correo y conserva sólo destinatario y asunto. Detalle en [SPRINT2_RESULTS.md](SPRINT2_RESULTS.md) y en [Correo](#correo-smtp).

- Envío de correo transaccional con proveedor configurable (SMTP o un servicio tipo Resend o SES) y plantillas en español.
- Cola de trabajos persistente en PostgreSQL (por ejemplo, pg-boss) con reintentos e idempotencia. Será la base de los recordatorios.
- Verificación de correo del paciente. Reservar en línea requiere un correo verificado.
- Recuperación de contraseña con token de un solo uso y vigencia corta, para pacientes y personal. Revoca las sesiones.
- Correo de confirmación al reservar, reprogramar o cancelar, con un archivo `.ics` para agregar al calendario.
- Invitación al personal por correo en lugar de una contraseña inicial compartida.
- **Terminado cuando**: un paciente nuevo verifica su correo, reserva y recibe la confirmación, y el envío sobrevive a reinicios de la API sin duplicarse.

### Sprint 3 · Recordatorios y confirmación de asistencia ✅

Entregado. Los recordatorios son trabajos de la cola programados al reservar o reprogramar (`runAt` = inicio − anticipación) que, al salir, vuelven a comprobar la cita: si se canceló, se reprogramó o la clínica cambió sus ajustes, no envían nada. Una bitácora (`NotificationLog`) con índice único parcial en los envíos exitosos garantiza un solo envío por cita, horario, anticipación y canal aun si el proceso muere a la mitad. El token del enlace se genera al enviar (nunca se guarda en claro), vale una vez y sólo para ese horario. WhatsApp está implementado con la Cloud API de Meta y queda inactivo hasta configurar las credenciales y la plantilla ([WhatsApp](#whatsapp-business)). Detalle en [SPRINT3_RESULTS.md](SPRINT3_RESULTS.md).

- Recordatorios automáticos 24 h y 2 h antes, configurables por clínica, por correo y por WhatsApp Business (Cloud API) con plantillas aprobadas.
- Enlace firmado para **confirmar** o **cancelar** desde el recordatorio, sin iniciar sesión, de un solo uso y con vencimiento.
- Estado de la cita «Confirmada por el paciente» visible en la agenda.
- Registro de cada envío (canal, estado, error) y consentimiento del paciente para recibir WhatsApp.
- **Terminado cuando**: los recordatorios salen a tiempo, nunca se duplican, respetan las cancelaciones de último minuto y la clínica ve quién confirmó.

### Sprint 4 · Pacientes y lista de espera ✅

Entregado. La verificación para vincular es por correo: el teléfono se agregará cuando WhatsApp esté conectado. Un horario liberado se aparta 2 horas (o hasta 30 min antes de la cita, lo que ocurra primero) con una oferta `WaitlistOffer` que bloquea ese horario en la disponibilidad pública, en las reservas en línea y en las del personal; PostgreSQL impide dos apartados traslapados del mismo médico. Detalle en [SPRINT4_RESULTS.md](SPRINT4_RESULTS.md).

- Vincular una ficha telefónica con la cuenta en línea del mismo paciente, con verificación por correo o teléfono, y fusionar duplicados con auditoría.
- Perfil del paciente en la clínica: historial de citas, inasistencias, notas internas y etiquetas.
- Edición de datos del paciente por recepción y por el propio paciente.
- Lista de espera por médico y servicio: al liberarse un horario se avisa al primero de la lista y se le aparta temporalmente.
- Citas subsecuentes: agendar la siguiente desde la cita atendida.
- **Terminado cuando**: recepción encuentra a cualquier paciente con su historial completo y los huecos por cancelación se vuelven a ocupar.

### Sprint 5 · Sedes y perfil profesional ✅

Entregado. La sede y el consultorio de cada cita salen del bloque del horario semanal donde cae (los bloques de un médico no se traslapan), así que el paciente sólo elige la sede cuando el médico atiende en varias. PostgreSQL impide asignar un consultorio a dos bloques traslapados y dos citas vigentes en el mismo consultorio. La migración crea una «Sede principal» por clínica con los datos existentes. El tipo de visita (primera vez o subsecuente) se exige en reservas en línea; el personal puede agendar cualquiera. Detalle en [SPRINT5_RESULTS.md](SPRINT5_RESULTS.md).

- Varias sedes por clínica, con dirección, mapa y horario. Un médico puede atender en varias sedes con horarios distintos.
- Consultorios o recursos por sede, para evitar dos citas a la vez en el mismo consultorio.
- Perfil profesional completo: foto, formación, certificaciones de consejo, idiomas, enfermedades que trata y aseguradoras aceptadas.
- Servicios con precio por sede y por médico, y servicios sólo para primera vez o subsecuente.
- **Terminado cuando**: una clínica con dos sedes publica horarios correctos por sede y no hay choques de consultorio.

### Sprint 6 · Perfil público, SEO y widget ✅

Entregado. Lighthouse en `/c/<clínica>` y `/c/<clínica>/<médico>`: rendimiento 99, accesibilidad 100, buenas prácticas 100 y SEO 100. El widget reservó desde otro origen dentro de un iframe. Ver [Widget y SEO](#widget-y-seo) y [SPRINT6_RESULTS.md](SPRINT6_RESULTS.md).

- Páginas públicas con renderizado en servidor, indexables, con URLs legibles (`/c/<clinica>/<medico>`), metadatos, Open Graph y schema.org (`Physician`, `MedicalClinic`).
- Mapa del sitio y página de cada médico con su agenda en línea.
- Widget «Reservar cita» para insertar en el sitio web de la clínica, más un botón para Google Maps e Instagram.
- **Terminado cuando**: las páginas pasan Lighthouse (SEO, accesibilidad ≥ 90) y el widget reserva desde un sitio externo.

### Sprint 7 · Opiniones verificadas

- Sólo pueden opinar pacientes con una cita en estado «Atendida», una opinión por cita, mediante una invitación por correo o WhatsApp tras la consulta.
- Calificación (puntualidad, trato, instalaciones) y comentario. Moderación por la clínica con motivos y sin borrar en silencio, más una respuesta pública del médico.
- Promedio y número de opiniones en el perfil público y en schema.org.
- **Terminado cuando**: no es posible publicar una opinión sin haber tenido una cita atendida y todo cambio de moderación queda auditado.

### Sprint 8 · Directorio y búsqueda

- Directorio público entre clínicas que activen su participación, con búsqueda por especialidad, padecimiento, ciudad o colonia, aseguradora, precio, primera disponibilidad y videoconsulta.
- Búsqueda de texto completo con `pg_trgm` y filtros geográficos (PostGIS o una búsqueda por radio).
- Resultados con la próxima disponibilidad y una reserva directa.
- Catálogo normalizado de especialidades y padecimientos.
- **Terminado cuando**: un paciente encuentra un médico por especialidad y zona y reserva en menos de un minuto.

### Sprint 9 · Pagos en línea

- Anticipo o pago completo al reservar con un proveedor para México (Stripe, Mercado Pago o Conekta), con tarjeta y OXXO o SPEI según el proveedor.
- Políticas por clínica: pago obligatorio u opcional, ventana de cancelación con reembolso y cargo por inasistencia.
- Webhooks idempotentes y conciliación de pagos con citas.
- **Terminado cuando**: un pago aprobado confirma la cita, un webhook repetido no duplica nada y los reembolsos siguen la política de la clínica.

### Sprint 10 · Telemedicina

- Servicios marcados como videoconsulta, con una sala por cita a través de un proveedor (Daily, Twilio o Jitsi autohospedado) y enlaces que caducan.
- Sala de espera virtual, prueba de cámara y micrófono y aviso al médico cuando el paciente entra.
- Consentimiento informado para teleconsulta.
- **Terminado cuando**: médico y paciente completan una videoconsulta desde el navegador, sin instalar nada, y la cita queda como atendida.

### Sprint 11 · Expediente clínico y recetas

- Expediente por paciente conforme a la NOM-004-SSA3-2012: historia clínica, notas de evolución (SOAP), signos vitales, alergias, diagnósticos (CIE-10) y archivos adjuntos.
- Recetas en PDF con los datos del médico y su cédula, más un código de verificación.
- Control de acceso estricto (sólo el médico tratante y el personal autorizado), bitácora de cada consulta del expediente, cifrado de adjuntos y retención de 5 años.
- Revisión de los lineamientos de la NOM-024-SSA3-2012 para la interoperabilidad futura.
- **Terminado cuando**: un médico documenta la consulta, imprime la receta y la bitácora muestra quién vio cada expediente.

### Sprint 12 · Suscripciones y facturación

- Planes para clínicas (número de médicos, recordatorios, telemedicina) con cobro recurrente y periodo de prueba.
- Facturación CFDI 4.0 a la clínica por su suscripción, y facturación opcional de consultas a los pacientes, a través de un PAC (por ejemplo, Facturama).
- Alta autoservicio de clínicas, con verificación de la cédula del médico.
- **Terminado cuando**: una clínica nueva se registra, paga, recibe su factura y sus límites se aplican según el plan.

### Sprint 13 · Reportes y analítica

- Ocupación de la agenda por médico, tasa de inasistencia, cancelaciones con anticipación, origen de las citas (en línea, teléfono, directorio o widget), ingresos y pacientes nuevos o recurrentes.
- Exportación a CSV y Excel y un resumen semanal por correo al propietario.
- **Terminado cuando**: el propietario ve los indicadores del mes y las cifras cuadran con la agenda.

### Sprint 14 · Integraciones

- Sincronización bidireccional con Google Calendar y Outlook, para que los eventos personales del médico bloqueen su agenda.
- API pública con llaves por clínica y webhooks de citas.
- Notificaciones push de la PWA y evaluación de una app móvil nativa.
- **Terminado cuando**: un evento personal en Google Calendar bloquea la agenda en menos de un minuto y un tercero integra las citas por API.

### Temas transversales (todos los sprints)

- **Privacidad (LFPDPPP)**: aviso de privacidad, consentimiento expreso para datos de salud, derechos ARCO y minimización de datos. Los datos de salud son sensibles.
- **Seguridad**: dependencias al día, respaldos probados, rate limit compartido antes de escalar a más de una réplica, monitoreo de errores y bitácoras sin datos médicos.
- **Calidad**: pruebas de integración contra PostgreSQL real para cada regla de negocio y migraciones aditivas con plan de reversión.

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

Directorio público entre clínicas, opiniones verificadas, recordatorios por correo, SMS o WhatsApp, videoconsulta, cobro en línea, expediente clínico (NOM-004/NOM-024), aseguradoras, vinculación de fichas telefónicas con cuentas en línea, verificación de correo y recuperación de contraseña, y Google Calendar. No se envían correos ni mensajes en esta entrega. Ver el [plan por sprints](#plan-por-sprints).

> Antes de operar con pacientes reales se recomienda publicar un aviso de privacidad conforme a la LFPDPPP. Los datos de salud son datos personales sensibles.

## Estructura

```text
apps/api/          API NestJS, Prisma (schema + migraciones), seed y pruebas
apps/web/          Next.js App Router y PWA
infra/nginx/       vhost de ejemplo (adaptar antes de usar)
scripts/           verificación local con PostgreSQL temporal en Docker
compose.yaml       servicios aislados del proyecto medora
```

## Correo (SMTP)

La API envía los correos por SMTP con nodemailer. Variables:

| Variable | Ejemplo | Notas |
|---|---|---|
| `SMTP_HOST` | `smtp.hostinger.com` | Obligatoria en producción. Sin ella (desarrollo) los correos se escriben en la bitácora de la API. |
| `SMTP_PORT` | `465` | 465 usa TLS directo; otro puerto usa STARTTLS obligatorio. |
| `SMTP_USER` | `no-reply@nut.com.mx` | Buzón que envía. |
| `SMTP_PASSWORD` | — | Contraseña del buzón. Sólo en `.env` del servidor. |
| `MAIL_FROM` | `Medora <no-reply@nut.com.mx>` | Debe usar el mismo dominio del buzón (SPF/DKIM). |
| `JOBS_POLL_MS` | `2000` | Intervalo del trabajador de la cola. |

Los enlaces de los correos llevan el token en el fragmento (`/verificar#…`, `/restablecer?tipo=paciente#…`, `/invitacion#…`): el navegador no lo envía al servidor ni en el Referer, y la página lo quita de la barra de direcciones al leerlo. Vigencias: verificación 24 h, recuperación 30 min, invitación 7 días.

Para revisar la cola en el servidor, abre `psql` y consulta los últimos trabajos:

```sh
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

```sql
SELECT type, payload->>'to' AS para, attempts, "lastError", "completedAt", "failedAt"
FROM "Job" ORDER BY "createdAt" DESC LIMIT 20;
```

## Widget y SEO

- Páginas públicas renderizadas en el servidor (caché de 60 s): `/c/<clínica>` y `/c/<clínica>/<médico>`, con título, descripción, URL canónica, Open Graph y JSON-LD (`MedicalClinic`, `Physician`). `sitemap.xml` y `robots.txt` se generan al pedirlos con `SITE_URL` (en Compose, `WEB_ORIGIN`). La web consulta la API por `API_INTERNAL_URL` en tiempo de ejecución.
- La URL de cada médico usa un identificador generado de su nombre (sin título ni acentos) que se puede editar en «Médicos» y no cambia si cambia el nombre.
- Widget para el sitio de la clínica (código listo en «Clínica → Compartir»):

```html
<script src="https://medora.nut.com.mx/widget.js" data-clinica="mi-clinica" async></script>
<!-- opcionales: data-medico="ana-lopez" data-posicion="flotante" data-texto="Agenda tu cita" data-color="#0f766e" -->
```

  Abre `/embed/<clínica>[/<médico>]` en un iframe. Sólo `/embed/*` permite incrustarse (`frame-ancestors *`); el resto responde `X-Frame-Options: DENY` y `frame-ancestors 'none'`. Dentro del iframe el navegador no guarda la cookie de sesión (es de un tercero), así que el paciente inicia sesión ahí y la sesión dura mientras tenga abierta la ventana.
- Canal de origen en cada reserva en línea: `web`, `widget`, `google` (`?origen=google`) o `instagram` (`?origen=instagram`); se ve en la agenda.

## WhatsApp Business

Opcional. Sin `WHATSAPP_TOKEN` el canal queda desactivado y los recordatorios salen sólo por correo.

1. En Meta Business: app con el producto WhatsApp, número verificado y un **token de acceso permanente** de un usuario del sistema.
2. Crear y aprobar la plantilla `recordatorio_cita` (categoría *Utilidad*, idioma *Español (MEX)*):
   - Cuerpo: `Hola {{1}}, te recordamos tu cita en {{2}} el {{3}} con {{4}}. Confírmanos tu asistencia o cancela desde el botón.`
   - Botón de tipo URL dinámica: `https://medora.nut.com.mx/cita?t={{1}}` con el texto «Confirmar o cancelar».
3. Variables en el `.env` del servidor y reiniciar la API:

| Variable | Valor |
|---|---|
| `WHATSAPP_TOKEN` | Token permanente (secreto) |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número en Meta |
| `WHATSAPP_TEMPLATE` | `recordatorio_cita` |
| `WHATSAPP_TEMPLATE_LANG` | `es_MX` |
| `WHATSAPP_DEFAULT_COUNTRY` | `52` (se antepone a teléfonos de 10 dígitos) |

4. En el panel, «Clínica → Recordatorios», activar «También por WhatsApp». Sólo reciben WhatsApp los pacientes con consentimiento: los de cuenta en línea lo activan en su registro o en «Mis citas»; para fichas telefónicas lo registra recepción.

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

## Respaldos

`scripts/backup-db.sh` genera un `pg_dump` en formato custom en `/var/backups/medora` (modo 600), comprueba que `pg_restore` puede leerlo y borra los de más de 14 días (`BACKUP_KEEP_DAYS`). `scripts/restore-check.sh` restaura el más reciente en un PostgreSQL temporal sin red y cuenta registros. En el VPS, `/etc/cron.d/medora-backup` ejecuta el respaldo a diario a las 03:15 (Ciudad de México) y la prueba de restauración cada domingo; la bitácora está en `/var/log/medora-backup.log`.

```sh
scripts/backup-db.sh
scripts/restore-check.sh
# Restaurar en producción (detener api/web antes):
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < /var/backups/medora/medora-AAAAMMDD-HHMMSS.dump
```

Los respaldos viven en el mismo VPS: protegen contra errores y borrados, no contra la pérdida del servidor. Pendiente: copia diaria fuera del VPS.

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
| POST | /api/auth/forgot · reset | Personal; Origin. `forgot` siempre responde 204 |
| POST | /api/auth/invitations/inspect · accept | Público con el token de la invitación; Origin |
| POST | /api/patient/auth/verify-email · forgot · reset | Paciente; Origin |
| POST | /api/patient/me/resend-verification | Paciente (3 por hora) |
| POST | /api/public/appointment-actions/inspect · confirm · cancel | Público con el token del recordatorio; Origin |
| GET | /api/clinic/patients/:id | Personal (médico: sólo sus pacientes y sus citas): historial, estadísticas, notas, auditoría |
| PATCH | /api/clinic/patients/:id | OWNER, ADMIN, RECEPTION: datos, etiquetas y WhatsApp (fichas con cuenta: sólo etiquetas) |
| POST | /api/clinic/patients/:id/notes · merge · link | Notas (personal); fusionar y vincular (OWNER, ADMIN, RECEPTION) |
| POST | /api/public/patient-links/inspect · accept | Público con el token de vinculación; Origin |
| GET / POST / PATCH | /api/clinic/locations | Personal / OWNER, ADMIN (sedes) |
| PUT / POST | /api/clinic/locations/:id/hours · /rooms | OWNER, ADMIN: horario de atención y consultorios |
| PATCH | /api/clinic/rooms/:id | OWNER, ADMIN |
| GET / PUT | /api/clinic/services/:id/prices | Personal / OWNER, ADMIN: precios por sede y médico |
| POST / DELETE | /api/clinic/doctors/:id/photo | OWNER, ADMIN o el propio médico (JPEG, PNG o WebP, máx. 900 KB) |
| GET | /api/public/doctors/:id/photo | Público, caché inmutable (la URL lleva la versión) |
| GET | /api/public/sitemap | Público: clínicas activas y médicos con agenda (para `sitemap.xml`) |
| GET / POST | /api/clinic/waitlist | Personal (médico: la suya) / OWNER, ADMIN, RECEPTION |
| POST | /api/clinic/waitlist/:id/remove · offers/:id/accept · offers/:id/release | OWNER, ADMIN, RECEPTION |
| POST | /api/public/clinics/:slug/waitlist | Paciente con correo confirmado (máx. 3 listas) |
| GET / POST | /api/patient/waitlist · /api/patient/waitlist/:id/leave | Paciente |
| POST | /api/public/waitlist-offers/inspect · accept · decline | Público con el token de la oferta; Origin |
| GET / PATCH | /api/clinic/members | OWNER, ADMIN según jerarquía |
| GET / POST | /api/clinic/invitations | OWNER, ADMIN según jerarquía |
| POST | /api/clinic/invitations/:id/resend · revoke | OWNER, ADMIN según jerarquía |
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
