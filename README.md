# Medora · Sprint 7

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
| 7 | Opiniones verificadas | ✅ Entregado |
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

### Sprint 7 · Opiniones verificadas ✅

Entregado. Al marcar una cita como «Atendida» se programa la invitación (2 h después) por correo y, si la clínica lo activó y el paciente dio su consentimiento, por WhatsApp con la plantilla `invitacion_opinion`. Además de la aplicación, un disparador de PostgreSQL rechaza cualquier opinión cuya cita no esté atendida, y un índice único garantiza una opinión por cita. El paciente también puede opinar desde «Mis citas». Detalle en [SPRINT7_RESULTS.md](SPRINT7_RESULTS.md).

- Sólo pueden opinar pacientes con una cita en estado «Atendida», una opinión por cita, mediante una invitación por correo o WhatsApp tras la consulta.
- Calificación (puntualidad, trato, instalaciones) y comentario. Moderación por la clínica con motivos y sin borrar en silencio, más una respuesta pública del médico.
- Promedio y número de opiniones en el perfil público y en schema.org.
- **Terminado cuando**: no es posible publicar una opinión sin haber tenido una cita atendida y todo cambio de moderación queda auditado.

### Sprint 8 · Directorio y búsqueda ✅

Entregado. `/directorio` busca entre las clínicas que activan «Aparecer en el directorio» (Configuración, o en el alta de clínica). Un texto que es una especialidad o un padecimiento del catálogo (con sinónimos: «pediatra», «presión alta») se busca como tal; lo demás, por texto con tolerancia a errores de dedo (`pg_trgm`). Cada resultado muestra precio «desde», opiniones, zona y la próxima disponibilidad con horarios que llevan directo al paso de confirmar. Disparadores de PostgreSQL mantienen la especialidad y los padecimientos del catálogo de cada médico en cualquier alta o edición. Páginas indexables por especialidad y por especialidad + ciudad. Detalle en [SPRINT8_RESULTS.md](SPRINT8_RESULTS.md).

- Directorio público entre clínicas que activen su participación, con búsqueda por especialidad, padecimiento, ciudad o colonia, aseguradora, precio, primera disponibilidad y videoconsulta.
- Búsqueda de texto completo con `pg_trgm` y filtros geográficos (PostGIS o una búsqueda por radio).
- Resultados con la próxima disponibilidad y una reserva directa.
- Catálogo normalizado de especialidades y padecimientos.
- **Terminado cuando**: un paciente encuentra un médico por especialidad y zona y reserva en menos de un minuto.

### Sprint 9 · Pagos en línea ✅

Entregado con Stripe Checkout (cuenta de Medora). Con pago obligatorio, la reserva en línea aparta el horario 35 min y el pago la confirma; si no llega, se cancela sola y el horario se libera. Los webhooks verifican la firma, se registran por id y consultan el estado real en Stripe, así que un evento repetido o fuera de orden no duplica nada. Reembolsos automáticos según la política de la clínica y pestaña «Pagos» para conciliar. Detalle en [SPRINT9_RESULTS.md](SPRINT9_RESULTS.md).

- Anticipo o pago completo al reservar con un proveedor para México (Stripe, Mercado Pago o Conekta), con tarjeta y OXXO o SPEI según el proveedor.
- Políticas por clínica: pago obligatorio u opcional, ventana de cancelación con reembolso y cargo por inasistencia.
- Webhooks idempotentes y conciliación de pagos con citas.
- **Terminado cuando**: un pago aprobado confirma la cita, un webhook repetido no duplica nada y los reembolsos siguen la política de la clínica.

### Sprint 10 · Telemedicina ✅

Entregado con Daily. En servicios marcados «También por videoconsulta», el paciente elige al reservar (o recepción al agendar) si la cita es por video. Cada cita tiene una sala privada que sólo abre de 15 min antes a 30 min después, con pases por persona; se entra desde el navegador con prueba de cámara y micrófono, con consentimiento informado registrado y aviso al médico en la agenda cuando el paciente está esperando. Detalle en [SPRINT10_RESULTS.md](SPRINT10_RESULTS.md).

- Servicios marcados como videoconsulta, con una sala por cita a través de un proveedor (Daily, Twilio o Jitsi autohospedado) y enlaces que caducan.
- Sala de espera virtual, prueba de cámara y micrófono y aviso al médico cuando el paciente entra.
- Consentimiento informado para teleconsulta.
- **Terminado cuando**: médico y paciente completan una videoconsulta desde el navegador, sin instalar nada, y la cita queda como atendida.

### Sprint 11 · Expediente clínico y recetas ✅

Entregado. Expediente por paciente con historia clínica por secciones de la NOM-004 (con versiones), alergias, notas SOAP con signos vitales y diagnósticos CIE-10, recetas en PDF con QR de verificación y adjuntos cifrados. Lo ve el médico tratante y quien autorice el propietario; recepción nunca. Toda consulta, cambio, impresión e intento negado queda en una bitácora que, como el resto del expediente, la base de datos no deja borrar ni alterar. Revisión de la NOM-024 en [docs/NOM-024-revision.md](docs/NOM-024-revision.md). Detalle en [SPRINT11_RESULTS.md](SPRINT11_RESULTS.md).

- Expediente por paciente conforme a la NOM-004-SSA3-2012: historia clínica, notas de evolución (SOAP), signos vitales, alergias, diagnósticos (CIE-10) y archivos adjuntos.
- Recetas en PDF con los datos del médico y su cédula, más un código de verificación.
- Control de acceso estricto (sólo el médico tratante y el personal autorizado), bitácora de cada consulta del expediente, cifrado de adjuntos y retención de 5 años.
- Revisión de los lineamientos de la NOM-024-SSA3-2012 para la interoperabilidad futura.
- **Terminado cuando**: un médico documenta la consulta, imprime la receta y la bitácora muestra quién vio cada expediente.

### Sprint 12 · Suscripciones y facturación ✅

Entregado: planes Consultorio, Clínica y Plus con 14 días de prueba, cobro recurrente con Stripe, límites por plan, alta autoservicio en `/registro` con verificación manual de la cédula desde `/admin`, y facturas CFDI 4.0 de la suscripción con Facturama. Queda pendiente la facturación de consultas a los pacientes, que requiere el RFC y el CSD de cada clínica (Facturama multiemisor). Detalle en [SPRINT12_RESULTS.md](SPRINT12_RESULTS.md).

- Planes para clínicas (número de médicos, recordatorios, telemedicina) con cobro recurrente y periodo de prueba.
- Facturación CFDI 4.0 a la clínica por su suscripción, y facturación opcional de consultas a los pacientes, a través de un PAC (por ejemplo, Facturama).
- Alta autoservicio de clínicas, con verificación de la cédula del médico.
- **Terminado cuando**: una clínica nueva se registra, paga, recibe su factura y sus límites se aplican según el plan.

### Sprint 13 · Reportes y analítica ✅

Entregado: pestaña «Reportes» con citas, inasistencia, cancelaciones (quién y con cuánta anticipación), ocupación por médico, origen de las citas, ingresos, cobros en línea y pacientes nuevos o recurrentes, filtrables por periodo, médico y sede. Exportación a CSV y Excel (plan Plus) y resumen semanal por correo los lunes a las 8:00. Las cifras se comprueban contra la agenda en las pruebas. Detalle en [SPRINT13_RESULTS.md](SPRINT13_RESULTS.md).

- Ocupación de la agenda por médico, tasa de inasistencia, cancelaciones con anticipación, origen de las citas (en línea, teléfono, directorio o widget), ingresos y pacientes nuevos o recurrentes.
- Exportación a CSV y Excel y un resumen semanal por correo al propietario.
- **Terminado cuando**: el propietario ve los indicadores del mes y las cifras cuadran con la agenda.

### Sprint 14 · Integraciones ✅

Entregado: sincronización con Google Calendar y Outlook (los eventos personales bloquean la agenda en segundos y las citas se escriben en el calendario del médico), API pública v1 con llaves por clínica, webhooks firmados de citas, avisos push de la PWA al personal y la evaluación de una app nativa ([docs/app-movil.md](docs/app-movil.md)). Detalle en [SPRINT14_RESULTS.md](SPRINT14_RESULTS.md).

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

4. Opcional, para invitar a opinar por WhatsApp: plantilla `invitacion_opinion` (Utilidad, `es_MX`), cuerpo `Hola {{1}}, ¿cómo te fue con {{2}} en {{3}}? Tu opinión ayuda a otros pacientes.` y botón URL dinámica `https://medora.nut.com.mx/opinion?t={{1}}`. Variable `WHATSAPP_REVIEW_TEMPLATE` si usas otro nombre.
5. En el panel, «Clínica → Recordatorios», activar «También por WhatsApp». Sólo reciben WhatsApp los pacientes con consentimiento: los de cuenta en línea lo activan en su registro o en «Mis citas»; para fichas telefónicas lo registra recepción.

## Pagos en línea (Stripe)

Opcional. Sin `STRIPE_SECRET_KEY` los pagos quedan desactivados y las clínicas no pueden activarlos.

1. Cuenta de Stripe México de Medora. En *Developers → API keys* copia la llave secreta (`sk_test_…` para pruebas, `sk_live_…` para cobrar de verdad; también sirve una llave restringida `rk_…` con permisos de Checkout Sessions, Customers y Refunds).
2. Para OXXO y SPEI, actívalos en *Settings → Payment methods*.
3. En *Developers → Webhooks* agrega el endpoint `https://medora.nut.com.mx/api/payments/stripe/webhook` con los eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` y `charge.refunded`. Copia su *signing secret* (`whsec_…`).
4. En el `.env` del servidor (entre comillas simples) y reinicia la API:

| Variable | Valor |
|---|---|
| `STRIPE_SECRET_KEY` | Llave secreta (secreto) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret del webhook (secreto) |

5. En el panel, «Clínica → Pagos en línea»: obligatorio u opcional, anticipo (20 %, 30 %, 50 % o completo), horas mínimas para reembolso y OXXO/SPEI.

Reglas:

- **Pago obligatorio:**
  - La reserva en línea queda «Pendiente de pago» y aparta el horario 35 min (hasta 2 h si el paciente reintenta).
  - Con ficha OXXO o SPEI emitida, el apartado dura hasta 48 h y nunca pasa de 1 h antes de la cita.
  - Al pagar se confirma la cita, se envían el correo con calendario y los recordatorios. Sin pago, se cancela y el horario se libera para otros pacientes y para la lista de espera.
- **Reembolsos:**
  - Si cancela la clínica, siempre se reembolsa completo.
  - Si cancela el paciente con la anticipación configurada, se reembolsa completo. Después, o si no asiste, no hay reembolso.
  - Un pago que llega para una cita ya cancelada, o un segundo cobro de la misma cita, se reembolsa solo.
  - Stripe no reembolsa pagos en OXXO: esos aparecen en «Pagos → Requiere atención» para devolverlos por transferencia y marcarlos.
- **Conciliación:** la pestaña «Pagos» muestra lo cobrado, lo reembolsado y el neto a transferir a cada clínica, con un botón «Conciliar» que vuelve a consultar Stripe. Al vencer un apartado también se consulta Stripe, por si se perdió un webhook.
- **Sin pago en línea:** las reservas desde la lista de espera y las que captura recepción no piden pago en línea.

## Videoconsultas (Daily)

Opcional. Sin `DAILY_API_KEY` las videoconsultas quedan desactivadas (los servicios no ofrecen la opción).

1. Crea una cuenta en [daily.co](https://dashboard.daily.co) (10,000 minutos al mes gratis; después ~$0.004 USD por minuto por participante) y copia la llave en *Developers → API keys*.
2. Guárdala en el servidor y reinicia la API: `ssh -t root@82.180.139.70 /opt/medora/scripts/set-daily-key.sh`.
3. En el panel, «Servicios»: marca «También por videoconsulta» en los servicios que se pueden dar por video.

Cómo funciona:

- **Reserva:** el paciente elige «En la clínica» o «Por videoconsulta»; recepción también puede agendarla por video.
- **Enlaces:** la confirmación y los recordatorios traen «Entrar a la videoconsulta». Es un enlace firmado que sólo abre la sala de esa cita, y sólo dentro de su ventana; también se entra desde «Mis citas».
- **Sala:** privada por cita, de 15 min antes a 30 min después, sin grabación. Cada persona entra con su propio pase y el médico como anfitrión.
- **Antes de entrar:** prueba de cámara y micrófono, y la primera vez el consentimiento para la consulta a distancia (se guarda la fecha y la versión del texto).
- **Médico:** la agenda se actualiza sola, marca «Paciente en sala de espera» y muestra el número de pacientes esperando en el título de la pestaña. Al terminar, el médico la marca como atendida como cualquier cita.

## Expediente clínico

- **Quién lo ve:**
  - El médico de los pacientes que atiende (con citas o notas suyas) y las personas a las que el propietario marque «Todos los pacientes» en «Equipo».
  - Recepción nunca. El propietario o la administración también pueden tener perfil de médico (consultorios pequeños).
- **Quién escribe:** sólo quien tiene perfil de médico. La nota se firma y desde ese momento no cambia; las correcciones van en una adenda. La receta emitida sólo se puede anular.
- **Bitácora:** cada consulta, cambio, impresión, descarga e intento sin permiso. Se ve en el expediente, y la de toda la clínica en «Equipo» (sólo el propietario).
- **Conservación:** la base de datos rechaza borrar cualquier registro clínico o de la bitácora (la NOM-004 pide al menos 5 años).
- **Recetas:** PDF con los datos de la clínica, el médico y su cédula, el paciente (edad, sexo y alergias), medicamentos e indicaciones, más un QR que lleva a `/receta/{código}`. Ahí la farmacia confirma que es auténtica y no fue anulada, viendo sólo las iniciales del paciente.
- **Adjuntos:** PDF, JPG o PNG de hasta 10 MB, cifrados con AES-256-GCM. La llave `RECORDS_ENCRYPTION_KEY` está en el `.env` del servidor y **debe respaldarse aparte**: los respaldos de la base no la incluyen, y sin ella los adjuntos no se pueden leer.

## Suscripciones y facturación

| Plan | Precio mensual (IVA incluido) | Médicos | Incluye |
|---|---|---|---|
| Consultorio | $499 | 1 | Agenda, reservas, recordatorios por correo, expediente y recetas, directorio, opiniones |
| Clínica | $1,299 | 5 | Todo lo anterior + WhatsApp, videoconsultas, cobro en línea |
| Plus | $2,499 | 15 | Todo lo anterior + archivos en el expediente y reportes |

- **Alta y prueba:** las clínicas se registran en `/registro` y tienen 14 días sin tarjeta. Pueden suscribirse antes de que termine la prueba (los días restantes no se cobran) desde «Suscripción».
- **Si la suscripción no está vigente:** prueba vencida o cancelada, o 7 días después de un cobro fallido, la clínica deja de recibir reservas en línea y sale del directorio. Su información sigue disponible en el panel.
- **Límites:** médicos activos y funciones por plan. Al bajar de plan se apagan WhatsApp y el cobro en línea si el nuevo plan no los incluye, y no se puede bajar con más médicos activos de los que permite el nuevo plan.
- **Verificación:** quien está en `SUPERADMIN_EMAILS` recibe un aviso con cada registro y verifica o rechaza la cédula en `/admin`, con un enlace al Registro Nacional de Profesionistas. Sin verificar, la clínica no aparece en el directorio ni cobra en línea. En `/admin` también se marcan las clínicas sin costo (cortesía).
- **Stripe:**
  - Los mismos `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` de los pagos. Agrega al webhook los eventos `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` e `invoice.payment_failed`.
  - Activa una vez el portal del cliente en *Settings → Billing → Customer portal*: es el botón «Cambiar tarjeta».
  - Los productos y precios se crean solos la primera vez.
- **CFDI 4.0 (Facturama, API de un solo emisor):**
  1. Crea la cuenta en Facturama y sube tu CSD con el perfil fiscal.
  2. Guarda las credenciales con `ssh -t root@82.180.139.70 /opt/medora/scripts/set-facturama.sh`.
  3. Cada cobro se factura solo (clave 81112106, unidad E48, PUE, forma de pago 04 crédito o 28 débito según la tarjeta) y se envía al correo fiscal de la clínica con el PDF y el XML. Sin datos fiscales queda «sin factura» y la clínica puede pedirla dentro de 30 días.
  4. `INVOICE_RESICO_RETENTION=true` agrega la retención de ISR del 1.25 % a personas morales: **confírmalo con tu contador**.

## Integraciones

- **API pública v1 y webhooks:** en el panel, «Integraciones». Ahí se crean las llaves (sólo consultar, o consultar y agendar), los webhooks firmados (`Medora-Signature: t=…,v1=HMAC-SHA256(secreto, t.cuerpo)`) y está la documentación de los endpoints. Los webhooks sólo aceptan URLs HTTPS públicas, se reintentan con espera creciente y se pausan tras 50 fallos seguidos.
- **Calendarios:** cada médico conecta su Google Calendar u Outlook en «Mi cuenta». Requiere `RECORDS_ENCRYPTION_KEY` (los tokens se guardan cifrados) y una app OAuth:
  - **Google Cloud:** activa la Google Calendar API. Pantalla de consentimiento con los alcances `openid`, `email` y `…/auth/calendar.events`. Cliente OAuth «Aplicación web» con la URI de redirección `https://medora.nut.com.mx/api/integrations/google/callback`. Variables `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. Mientras la app esté «en prueba», agrega a los médicos como usuarios de prueba (hasta 100). Para abrirla a todos, Google revisa los alcances sensibles.
  - **Microsoft Entra:** registro de app multiinquilino y cuentas personales. Redirección web `https://medora.nut.com.mx/api/integrations/microsoft/callback`, permisos delegados `Calendars.ReadWrite`, `User.Read` y `offline_access`, y un secreto de cliente. Variables `MICROSOFT_CLIENT_ID` y `MICROSOFT_CLIENT_SECRET`.
  - Guárdalas con `ssh -t root@82.180.139.70 /opt/medora/scripts/set-calendar-keys.sh`.
- **Avisos push:** `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`, generadas en el servidor. El personal los activa en «Mi cuenta → Avisos en este dispositivo».

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

## Alta de clínicas

Cada clínica nueva llena un formulario guiado en `/alta` (sedes, equipo, médicos con foto, servicios y precios, horarios con consultorio, reglas, recordatorios, privacidad y contacto). Se guarda solo y se puede retomar con el mismo enlace privado (90 días). Al enviarlo se valida todo: traslapes, horarios fuera de la sede, consultorios ocupados por dos médicos, un solo propietario, etc.

```sh
# En el VPS, desde /opt/medora
docker compose --profile tools run --rm tools node dist/onboarding-cli.js crear "Clínica del Valle" contacto@clinica.mx
docker compose --profile tools run --rm tools node dist/onboarding-cli.js listar
docker compose --profile tools run --rm tools node dist/onboarding-cli.js ver <id>
docker compose --profile tools run --rm tools node dist/onboarding-cli.js importar <id>
```

- `crear` imprime el enlace para la clínica (el token va en el `#`, nunca llega a los registros del servidor).
- `importar` crea en una sola transacción la clínica, sedes, consultorios, médicos (con foto y perfil), servicios, precios, horarios y días bloqueados. El propietario recibe un correo para elegir su contraseña; el resto del equipo, su invitación (los médicos quedan vinculados a su perfil al aceptarla).
- Con `ONBOARDING_NOTIFY_EMAIL` en `.env`, llega un aviso cada vez que una clínica envía su alta.
- El formulario no pide contraseñas ni datos de pacientes.

## Respaldos

`scripts/backup-db.sh` genera un `pg_dump` en formato custom en `/var/backups/medora` (modo 600), comprueba que `pg_restore` puede leerlo y borra los de más de 14 días (`BACKUP_KEEP_DAYS`). `scripts/restore-check.sh` restaura el más reciente en un PostgreSQL temporal sin red y cuenta registros. En el VPS, `/etc/cron.d/medora-backup` ejecuta el respaldo a diario a las 03:15 (Ciudad de México) y la prueba de restauración cada domingo; la bitácora está en `/var/log/medora-backup.log`.

```sh
scripts/backup-db.sh
scripts/restore-check.sh
# Restaurar en producción (detener api/web antes):
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < /var/backups/medora/medora-AAAAMMDD-HHMMSS.dump
```

### Monitoreo

`scripts/monitor.sh` corre cada 5 minutos en el VPS (`/etc/cron.d/medora-monitor`; bitácora en `/var/log/medora-monitor.log`) y revisa:

- la API y la web a través de nginx;
- los contenedores;
- los trabajos fallidos o atrasados de la cola;
- que exista un respaldo de menos de 26 h y su copia en Drive;
- que al certificado le queden 21 días o más;
- que el disco esté por debajo del 85 %.

Avisa por correo, con el SMTP del `.env`, a `MONITOR_EMAIL` (o, si no existe, a `ONBOARDING_NOTIFY_EMAIL`). El correo sale cuando aparece un problema, cada 24 h mientras siga y cuando se resuelve. `scripts/monitor.sh --prueba` envía un correo de prueba.

Para cuando se cae el VPS completo, el workflow `.github/workflows/disponibilidad.yml` revisa el sitio desde GitHub cada 15 minutos. Si falla, GitHub manda su correo de ejecución fallida.

### Certificado TLS

Sólo se usa el puerto 443 (el 80 está cerrado en el firewall de Hostinger), así que Let's Encrypt valida por DNS. Al renovar, certbot llama a `scripts/acme-dns-hook.sh`, que publica el TXT `_acme-challenge` con la API DNS de Hostinger, espera a que se propague y luego lo borra. El token se carga una vez con `scripts/set-hostinger-dns-token.sh`, que también ajusta la renovación y la prueba en seco.

### Copia externa (Google Drive)

`scripts/offsite-backup.sh` sube cada día a las 03:30 (Ciudad de México) los respaldos recientes y el `.env` a Google Drive, cifrados con `rclone crypt` (contenido y nombres), conserva 30 días (`OFFSITE_KEEP_DAYS`) y comprueba que el último respaldo llegó íntegro. La configuración se hace una vez con `scripts/set-gdrive-backup.sh`. El permiso de Drive es `drive.file`, así que rclone sólo ve la carpeta `medora-respaldos` que él mismo crea.

La contraseña de cifrado está en `/root/medora-offsite-password` y hay que guardarla fuera del servidor. Sin ella las copias no se pueden abrir. Para recuperar una copia desde otra máquina:

```sh
rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"   # y crear el remoto medora-gdrive con ese token
rclone config create medora-cifrado crypt remote=medora-gdrive:medora-respaldos password="$(rclone obscure 'CONTRASEÑA')"
rclone ls medora-cifrado:db
rclone copy medora-cifrado:db/medora-AAAAMMDD-HHMMSS.dump .
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
| GET | /api/public/directory | Público: especialidades y ciudades con médicos en el directorio |
| GET | /api/public/directory/search | Público: `q`, `especialidad`, `padecimiento`, `ciudad`, `colonia`, `aseguradora`, `precioMax`, `videoconsulta`, `cuando`, `lat`/`lng`/`radioKm`, `orden`, `pagina` |
| GET | /api/public/directory/suggest · catalog | Público: sugerencias y catálogo de especialidades y padecimientos |
| POST | /api/patient/appointments/:id/checkout | Paciente: abre (o reutiliza) la página de pago de Stripe |
| POST | /api/payments/stripe/webhook | Stripe (firma `Stripe-Signature`) |
| GET · POST | /api/clinic/payments · :id/sync · :id/manual-refund | Propietario o administración: conciliación |
| POST | /api/video/link/info · join · heartbeat | Enlace firmado del correo + Origin |
| GET · POST | /api/patient/appointments/:id/video · video/join · video/heartbeat | Paciente |
| GET · POST | /api/clinic/appointments/:id/video · video/join | Médico de la cita, propietario o administración |
| GET · PATCH · POST | /api/clinic/patients/:id/record (profile, allergies, notes, notes/:id/sign, prescriptions, prescriptions/:id/pdf · void, files, log) | Médico tratante o personal autorizado; escribe sólo un médico |
| GET | /api/clinic/icd10?q= · /api/clinic/clinical-audit | Personal clínico · propietario |
| PATCH | /api/clinic/members/:id/clinical-access | Propietario |
| GET | /api/public/prescriptions/:code | Público (verificación de recetas) |
| GET · POST | /api/public/plans · /api/public/signup | Público (alta autoservicio; Origin y límite por IP) |
| GET · POST · PUT | /api/clinic/subscription (checkout, plan, cancel, portal, billing, invoices/:id/cfdi, invoices/:id/pdf\|xml) | Propietario (cambios) y administración |
| GET · PATCH | /api/admin/clinics | Administración de Medora (`SUPERADMIN_EMAILS`) |
| GET · POST | /api/v1/doctors · services · locations · availability · appointments (`POST`, `:id`, `:id/cancel`) | Llave de API (`Bearer mdr_…`) |
| GET · POST · PATCH · DELETE | /api/clinic/integrations (keys, webhooks, webhooks/:id/ping) | Propietario o administración |
| GET · POST · PATCH · DELETE | /api/clinic/calendar (`:provider/start`, `busy`) · /api/integrations/:provider/callback · notify | Médico · Google y Microsoft |
| GET · POST · DELETE | /api/clinic/push (key, subscribe, test) | Personal |
| GET · POST | /api/clinic/reports/summary · export/csv\|xlsx · weekly-preview | Propietario o administración (exportar: plan Plus) |
| POST | /api/public/reviews/inspect · /api/public/reviews | Público con el token de la invitación; Origin |
| GET | /api/public/reviews/clinics/:slug/doctors/:doctorSlug?page | Público: opiniones publicadas (10 por página) |
| POST | /api/patient/appointments/:id/review | Paciente: opinar sobre su cita atendida |
| GET | /api/clinic/reviews?status&doctorId | Personal (médico: las suyas) |
| POST | /api/clinic/reviews/:id/hide · restore | OWNER, ADMIN (motivo obligatorio al ocultar; se avisa al paciente) |
| PUT / DELETE | /api/clinic/reviews/:id/reply | El médico de la cita, OWNER o ADMIN |
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
