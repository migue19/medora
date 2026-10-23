# Resultados de verificación · Sprint 12

Fecha: 22 de octubre de 2026. Entorno: macOS, Node 24, PostgreSQL 17 local; Stripe y Facturama simulados en las pruebas (la firma de los webhooks se verifica con el SDK real de Stripe).

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (API + web) | OK |
| Pruebas unitarias | 16/16 |
| Pruebas de integración con PostgreSQL real (base creada desde cero) | 81/81 (76 anteriores + 5 nuevas) |
| `npm run build` (API + Next.js) | OK |
| Navegador (local) | Registro en `/registro` con el plan del enlace, activación de la cuenta con el correo, entrada al panel, aviso de cédula en revisión y pestaña «Suscripción» con prueba de 14 días, planes y datos fiscales |
| Cobro real con Stripe y timbrado real con Facturama | Pendiente: eventos de suscripción en el webhook de Stripe y cuenta de Facturama |

## Qué se entregó

- **Planes:** Consultorio $499 (1 médico), Clínica $1,299 (5 médicos, WhatsApp, videoconsultas, cobro en línea) y Plus $2,499 (15 médicos, todo más los archivos del expediente), con IVA incluido y 14 días de prueba sin tarjeta.
- **Límites aplicados en la API:**
  - Médicos activos, al crearlos o reactivarlos.
  - WhatsApp, videoconsultas (servicios, sala y perfil público), cobro en línea y archivos del expediente.
  - Al bajar de plan se apagan las funciones que el nuevo plan no incluye. No se puede bajar con más médicos activos de los que permite.
- **Vigencia:**
  - Sin suscripción vigente (prueba vencida, cancelada, o 7 días después de un cobro fallido) no hay reservas ni cambios en línea y la clínica sale del directorio.
  - El personal conserva el acceso a toda su información.
  - Las clínicas existentes (piloto y demo) quedaron sin costo y verificadas.
- **Cobro recurrente con Stripe:**
  - Checkout de suscripción que conserva los días de prueba que queden; cambio de plan con prorrateo; cancelación al final del periodo y reactivación; portal para cambiar la tarjeta.
  - Los productos y precios se crean solos.
  - Los webhooks consultan el estado real en Stripe y se registran por id; un cobro repetido no se duplica.
- **CFDI 4.0 con Facturama:**
  - Cada cobro se factura solo: subtotal e IVA que suman exactamente el cobro, clave 81112106, unidad E48, PUE, forma de pago 04 o 28 según la tarjeta.
  - Se envía al correo fiscal con el PDF y el XML, y se descarga desde el panel.
  - Sin datos fiscales queda «sin factura» y se puede pedir dentro de 30 días.
  - Un rechazo del PAC queda con su motivo y sin reintentos; los errores temporales se reintentan.
  - Retención de ISR para RESICO opcional (apagada).
- **Alta autoservicio:**
  - Clínica en prueba, sede principal y propietario que es el médico responsable, con su cédula.
  - La activación de la cuenta llega por correo; un correo que ya tiene cuenta recibe un aviso y no se crea nada (la respuesta es idéntica).
  - Límite de 5 registros por hora por IP y Origin del sitio.
- **Verificación de la cédula:**
  - Aviso a la administración; panel `/admin` con enlace al Registro Nacional de Profesionistas de la SEP para verificar o rechazar (el rechazo lleva motivo).
  - Se avisa a la clínica por correo. Sin verificar no aparece en el directorio ni cobra en línea.
  - También se marcan cortesías sin costo.
- **Pantallas:**
  - `/registro` con los planes; los planes también en la página de inicio.
  - Pestaña «Suscripción»: plan, estado, médicos usados, cambiar de plan, suscribirse, cambiar tarjeta, cancelar o reactivar, datos fiscales y facturas.
  - Avisos arriba del panel (prueba por terminar, suscripción vencida, cobro fallido, cédula en revisión o rechazada).
  - Aviso de privacidad **en borrador**, para revisión legal.

## Cobertura de integración nueva

- **IVA y retención:** el subtotal y el IVA suman exactamente el precio de cada plan; la retención de ISR sólo aplica a personas morales.
- **Alta:**
  - Cédula inválida o sin aceptar el aviso da 400.
  - Slug y prueba de 14 días; plan, estado y verificación correctos; el médico queda vinculado al propietario.
  - Activación de la cuenta y entrada al panel; aviso a la administración.
  - Un correo repetido no crea nada y recibe aviso.
  - Sin verificar no entra al directorio.
- **Límites:**
  - Un segundo médico en Consultorio da 403 con un mensaje claro; videoconsulta, WhatsApp y cobro bloqueados.
  - Cambio de plan en prueba; no se puede bajar con 2 médicos activos; al bajar se apaga WhatsApp; no se reactiva un médico por encima del límite.
- **Cobro y factura:**
  - Prueba vencida: sin reservas (403) y checkout sin días de prueba; la suscripción activa las reactiva.
  - Cobro repetido sin duplicar; sin datos fiscales queda «sin factura».
  - RFC inválido da 400; se pide la factura y se timbra con forma de pago 28 (débito), razón social en mayúsculas y total exacto; llega el correo con PDF y XML en base64; descarga del PDF.
  - Rechazo del PAC marcado como fallido.
  - Cambio de plan desde Stripe; cobro fallido con periodo de gracia; cancelada, sin reservas pero con el panel disponible.
- **Administración:**
  - Sólo superadministradores; el rechazo exige motivo.
  - Verificar avisa por correo y habilita el directorio; la cortesía da todo incluido e impide suscribirse.
