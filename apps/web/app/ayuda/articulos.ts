/**
 * Contenido del centro de ayuda. Texto con **negritas**; las capturas viven en /public/ayuda y se regeneran con
 * marketing/ayuda/capturas.mjs a partir de la clínica demo.
 */
export type Block =
  | { p: string }
  | { h: string }
  | { steps: string[] }
  | { list: string[] }
  | { img: string; alt: string; mobile?: boolean }
  | { tip: string };

export interface Article {
  slug: string;
  title: string;
  summary: string;
  category: Category;
  body: Block[];
}

export type Category = 'Primeros pasos' | 'Agenda y citas' | 'Pacientes y expediente' | 'Crece tu consulta' | 'Cuenta y suscripción' | 'Para pacientes';
export const CATEGORIES: { name: Category; description: string }[] = [
  { name: 'Primeros pasos', description: 'Da de alta tu clínica, médicos, servicios y equipo.' },
  { name: 'Agenda y citas', description: 'Agenda por teléfono, reservas en línea y recordatorios.' },
  { name: 'Pacientes y expediente', description: 'Fichas, expediente clínico y recetas.' },
  { name: 'Crece tu consulta', description: 'Directorio, opiniones, cobros, videoconsultas y reportes.' },
  { name: 'Cuenta y suscripción', description: 'Planes, facturas, calendario e integraciones.' },
  { name: 'Para pacientes', description: 'Cómo agendar, confirmar y administrar tus citas.' },
];

export const ARTICLES: Article[] = [
  // ------------------------------------------------------------------ Primeros pasos
  {
    slug: 'registrar-tu-clinica', category: 'Primeros pasos',
    title: 'Registra tu clínica o consultorio',
    summary: 'Crea tu cuenta, prueba Tepahti 14 días sin tarjeta y verifica tu cédula.',
    body: [
      { p: 'Tepahti funciona para un consultorio con un solo médico o para clínicas con varios médicos y sedes. El registro toma unos minutos.' },
      { steps: [
        'Entra a **tepahti.nut.com.mx/registro** o toca **Prueba 14 días gratis** en la página de inicio.',
        'Escribe el **nombre de la clínica o consultorio** como quieres que lo vean tus pacientes.',
        'Captura los datos del **médico responsable**: nombre, especialidad y **cédula profesional**.',
        'Escribe tu nombre, correo y teléfono, acepta el aviso de privacidad y envía el formulario.',
        'Abre el correo que te enviamos y elige tu contraseña. Desde ese momento ya puedes entrar al panel.',
      ] },
      { tip: 'Revisamos la cédula profesional en el Registro Nacional de Profesionistas. Mientras está **en revisión** puedes configurar todo; verás el estado en la pestaña **Suscripción**.' },
      { h: 'Qué configurar primero' },
      { list: [
        '**Servicios**: qué consultas ofreces, cuánto duran y cuánto cuestan.',
        '**Médicos y horarios**: el perfil de cada médico y su horario semanal.',
        '**Clínica**: dirección, teléfono, reglas de reserva y recordatorios.',
        '**Equipo**: invita a recepción y a los demás médicos.',
      ] },
      { p: 'Con eso tu página de reservas ya queda lista para compartir.' },
    ],
  },
  {
    slug: 'servicios-y-precios', category: 'Primeros pasos',
    title: 'Servicios, duración y precios',
    summary: 'Define qué consultas ofreces; la duración marca los horarios disponibles.',
    body: [
      { p: 'Cada servicio tiene un nombre, una duración y un precio base. La duración define cada cuánto aparecen horarios libres en tu agenda y en tu página de reservas.' },
      { img: 'servicios', alt: 'Pestaña Servicios con el formulario de nuevo servicio y la lista de servicios' },
      { steps: [
        'En el panel abre la pestaña **Servicios**.',
        'En **Nuevo servicio** escribe el nombre, la **duración (min)** y el **precio base MXN**.',
        'En **Para** elige si el servicio es para cualquier paciente, **sólo primera vez** o **sólo subsecuentes**.',
        'Marca **También por videoconsulta** si el paciente puede tomarlo a distancia.',
        'Toca **Agregar**.',
      ] },
      { h: 'Precios distintos por sede o por médico' },
      { p: 'Toca **Precios** junto al servicio para fijar un precio diferente en una sede o con un médico en particular (por ejemplo, la consulta con el jefe de servicio).' },
      { tip: 'Cambiar el precio o la duración no altera las citas que ya están agendadas.' },
    ],
  },
  {
    slug: 'medicos-y-horarios', category: 'Primeros pasos',
    title: 'Médicos, perfiles y horarios',
    summary: 'Da de alta a cada médico con su perfil profesional, sus servicios y su horario semanal.',
    body: [
      { img: 'medicos', alt: 'Pestaña Médicos y horarios con las tarjetas de cada médico y su horario' },
      { h: 'Agregar un médico' },
      { steps: [
        'Abre **Médicos y horarios** y toca **+ Agregar médico**.',
        'Escribe el **nombre a mostrar** (por ejemplo, «Dra. Sofía Ramírez»), la **especialidad** y la **cédula profesional**.',
        'Elige los **servicios que ofrece**.',
        'Completa su perfil: presentación, formación, certificaciones de consejo, idiomas, padecimientos que atiende y aseguradoras aceptadas. Todo esto aparece en su página pública.',
        'Si el médico va a usar Tepahti, elige el **usuario vinculado** (primero invítalo desde **Equipo**).',
        'Toca **Guardar**.',
      ] },
      { img: 'medico-editar', alt: 'Formulario para editar el perfil profesional de un médico' },
      { tip: 'Escribe los padecimientos uno por renglón. Los que están en nuestro catálogo («hipertensión», «asma», «acné»…) ayudan a que los pacientes encuentren al médico en el directorio.' },
      { h: 'Horario semanal y bloqueos' },
      { steps: [
        'En la tarjeta del médico toca **Horario y bloqueos**.',
        'Agrega un bloque por cada día y turno (por ejemplo, lunes de 9:00 a 14:00 en la sede principal) y toca **Guardar horario**.',
        'Para vacaciones, congresos o juntas usa **Agregar bloqueo** con fecha y hora de inicio y fin.',
      ] },
      { p: 'Los pacientes sólo ven horarios que caben completos dentro de un bloque y que no chocan con otra cita, un bloqueo o un evento de su calendario conectado.' },
    ],
  },
  {
    slug: 'sedes-y-consultorios', category: 'Primeros pasos',
    title: 'Sedes y consultorios',
    summary: 'Si atiendes en varios lugares, cada sede tiene su dirección, horario y consultorios.',
    body: [
      { p: 'Todas las clínicas empiezan con una sede principal. Agrega más en **Clínica → Sedes y consultorios** con **+ Agregar sede**.' },
      { list: [
        '**Dirección, colonia, ciudad o alcaldía y código postal**: se muestran al paciente y en los correos.',
        '**Enlace del mapa** de Google Maps para llegar.',
        '**Coordenadas**: permiten que te encuentren con «Cerca de mí» en el directorio.',
        '**Horario de atención** de la sede.',
        '**Consultorios**: Tepahti evita que dos médicos tengan cita al mismo tiempo en el mismo consultorio.',
      ] },
      { p: 'En el horario de cada médico eliges en qué sede (y consultorio) atiende cada bloque. Si un médico atiende en varias sedes, el paciente elige la sede al reservar.' },
    ],
  },
  {
    slug: 'equipo-y-permisos', category: 'Primeros pasos',
    title: 'Invita a tu equipo: roles y permisos',
    summary: 'Recepción, médicos y administradores, cada quien con su acceso.',
    body: [
      { img: 'equipo', alt: 'Pestaña Equipo con el formulario para invitar a un integrante' },
      { steps: [
        'Abre **Equipo** y llena **Invitar integrante** con nombre, correo y **rol**.',
        'Toca **Enviar invitación**. La persona recibe un correo para aceptar y crear su contraseña; el enlace vence en 7 días.',
        'Si invitaste a un médico, vincula su usuario a su perfil en **Médicos y horarios**.',
      ] },
      { h: 'Qué puede hacer cada rol' },
      { list: [
        '**Propietario**: todo, incluidos la suscripción, los pagos y quién ve los expedientes.',
        '**Administrador**: igual que el propietario, salvo cambiar la suscripción y dar acceso a los expedientes clínicos.',
        '**Recepción**: agenda, pacientes, lista de espera y opiniones. **Nunca ve el expediente clínico.**',
        '**Médico**: su agenda, sus pacientes, el expediente de quienes atiende y su horario.',
      ] },
      { tip: 'En la columna **Expedientes clínicos** el propietario puede dar acceso a **todos los pacientes** a quien lo necesite (por ejemplo, la dirección médica). Cada consulta del expediente queda en la **Bitácora de expedientes**.' },
    ],
  },

  // ------------------------------------------------------------------ Agenda y citas
  {
    slug: 'agenda-del-dia', category: 'Agenda y citas',
    title: 'Tu agenda: día, semana y estados de cada cita',
    summary: 'Ve las citas por médico o sede, marca asistencia, reprograma y cancela.',
    body: [
      { img: 'agenda', alt: 'Agenda del día con las citas de los médicos' },
      { list: [
        'Cambia entre **Día** y **Semana**, y filtra por **médico** o **sede**.',
        'Las flechas mueven la fecha; **Hoy** regresa al día actual.',
        'Cada cita muestra paciente, servicio, médico, precio, teléfono y si llegó **en línea**.',
        '**Confirmada por el paciente** significa que confirmó desde el recordatorio.',
      ] },
      { h: 'Después de la consulta' },
      { p: 'Cuando la cita ya empezó aparecen **Atendida** y **No asistió**. Marcar «Atendida» permite **Agendar subsecuente** con un toque y, si tienes las opiniones activadas, invita al paciente a calificar su consulta.' },
      { h: 'Reprogramar o cancelar' },
      { p: '**Reprogramar** muestra sólo horarios libres del mismo médico. **Cancelar** pide un motivo. En ambos casos el paciente recibe un correo y el horario se libera (si hay lista de espera, se ofrece al siguiente).' },
    ],
  },
  {
    slug: 'agendar-por-telefono', category: 'Agenda y citas',
    title: 'Agendar una cita por teléfono o en mostrador',
    summary: 'Busca al paciente, elige médico, servicio y un horario libre.',
    body: [
      { img: 'nueva-cita', alt: 'Formulario Nueva cita con paciente, médico, servicio y horarios libres' },
      { steps: [
        'En **Agenda** toca **Nueva cita**.',
        'Escribe nombre, teléfono o correo en **Buscar paciente** y elígelo. Si es nuevo, toca **+ Registrar paciente nuevo**.',
        'Elige **Médico** y **Servicio**.',
        'Toca un horario libre. Si necesitas una hora exacta dentro del horario del médico, abre **Agendar en una hora específica**.',
        'Si es videoconsulta, marca la casilla correspondiente; el paciente recibe el enlace por correo.',
        'Toca **Agendar cita**.',
      ] },
      { p: 'El paciente recibe la confirmación por correo con un archivo para agregarla a su calendario, y los recordatorios salen solos.' },
      { tip: 'Pregunta al paciente si acepta recordatorios por WhatsApp y marca la casilla en su ficha: es la forma más efectiva de reducir inasistencias.' },
    ],
  },
  {
    slug: 'reservas-en-linea', category: 'Agenda y citas',
    title: 'Reservas en línea 24/7',
    summary: 'Tu página de reservas, el botón para tu sitio web y las reglas para reservar.',
    body: [
      { p: 'Cada clínica tiene su página pública en **tepahti.nut.com.mx/c/tu-clinica** y cada médico la suya. Ahí tus pacientes ven médicos, precios y opiniones, eligen un horario libre y confirman con su cuenta.' },
      { img: 'pagina-reservas', alt: 'Página de reservas de la clínica vista en un celular', mobile: true },
      { h: 'Reglas de reserva' },
      { p: 'En **Clínica → Datos y reglas de reserva** decides:' },
      { list: [
        '**Aceptar reservas en línea** (puedes pausarlas cuando quieras).',
        '**Anticipación mínima para reservar**, en horas (por ejemplo, 2 horas antes).',
        '**Reservar hasta**, en días hacia adelante.',
        '**Cancelar o reprogramar en línea hasta** cierto número de horas antes de la cita.',
      ] },
      { h: 'Compártela en todos lados' },
      { img: 'compartir', alt: 'Opciones para compartir la página y el botón de reservas' },
      { list: [
        '**Botón «Reservar cita» para tu sitio web** y **botón flotante en la esquina**: copia el código y pégalo en tu página.',
        '**Página de cada médico**: ideal para la biografía de Instagram, Google Maps o WhatsApp Business.',
      ] },
      { tip: 'En **Reportes → Origen de las citas** ves cuántas llegan por tu página, tu sitio web, el directorio o Google.' },
    ],
  },
  {
    slug: 'recordatorios-y-confirmacion', category: 'Agenda y citas',
    title: 'Recordatorios y confirmación de asistencia',
    summary: 'Tepahti recuerda cada cita y el paciente confirma o cancela en un toque.',
    body: [
      { img: 'recordatorios', alt: 'Configuración de recordatorios a pacientes' },
      { steps: [
        'En **Clínica → Recordatorios a pacientes** activa **Enviar recordatorios**.',
        'Marca cuándo enviarlos, hasta tres momentos (por ejemplo, 24 horas y 2 horas antes).',
        'Toca **Guardar recordatorios**.',
      ] },
      { p: 'Cada recordatorio trae un enlace para **confirmar asistencia** o **cancelar**, sin iniciar sesión. Si el paciente confirma, la cita aparece como **Confirmada por el paciente** en tu agenda. Si cancela, el horario se libera solo.' },
      { img: 'confirmar-cita', alt: 'Página para que el paciente confirme o cancele su cita', mobile: true },
      { list: [
        'Los recordatorios por **correo** están incluidos en todos los planes.',
        'Por **WhatsApp** están disponibles desde el plan **Clínica**, para pacientes que lo aceptaron.',
        'Si reprogramas la cita, los recordatorios se ajustan solos; si la cancelas, no se envían.',
      ] },
    ],
  },
  {
    slug: 'lista-de-espera', category: 'Agenda y citas',
    title: 'Lista de espera: llena los huecos de las cancelaciones',
    summary: 'Cuando alguien cancela, Tepahti ofrece el horario al siguiente paciente de la lista.',
    body: [
      { list: [
        'Desde la ficha de un paciente toca **Agregar a la lista de espera** y elige médico, servicio y, si quieres, un rango de fechas.',
        'El paciente también puede anotarse en línea cuando no encuentra horario («Anótate en la lista de espera»).',
      ] },
      { p: 'Cuando se libera un horario compatible, Tepahti se lo **aparta 2 horas** al primero de la lista y le avisa por correo para que lo acepte. Si no responde o no le sirve, pasa al siguiente.' },
      { p: 'En la pestaña **Lista de espera** ves quién está anotado y los horarios apartados. Puedes **Agendar este horario** por el paciente o marcar **No le sirve**.' },
    ],
  },

  // ------------------------------------------------------------------ Pacientes y expediente
  {
    slug: 'fichas-de-pacientes', category: 'Pacientes y expediente',
    title: 'Fichas de pacientes',
    summary: 'Historial de citas, notas internas, etiquetas, duplicados y cuentas en línea.',
    body: [
      { img: 'pacientes', alt: 'Pestaña Pacientes con la búsqueda y la lista' },
      { p: 'En **Pacientes** buscas por nombre, teléfono o correo. La ficha muestra:' },
      { list: [
        '**Historial de citas** con asistencias e inasistencias.',
        '**Notas internas** para el equipo (no son parte del expediente clínico).',
        '**Etiquetas** separadas por comas, por ejemplo «aseguradora GNP» o «paciente VIP».',
        'Si **acepta recordatorios por WhatsApp**.',
      ] },
      { h: 'Duplicados y cuentas en línea' },
      { list: [
        '**Fusionar duplicado** une dos fichas de la misma persona y conserva todo su historial.',
        '**Vincular con cuenta en línea** envía un enlace al paciente para unir la ficha que creó recepción con la cuenta con la que reserva en línea.',
      ] },
    ],
  },
  {
    slug: 'expediente-clinico', category: 'Pacientes y expediente',
    title: 'Expediente clínico',
    summary: 'Historia clínica, alergias, notas SOAP con signos vitales y diagnósticos CIE-10.',
    body: [
      { p: 'Abre el expediente desde la cita en la agenda (**Expediente clínico**) o desde la ficha del paciente. Sólo lo ven el médico tratante y quien autorice el propietario.' },
      { img: 'expediente', alt: 'Expediente clínico con las notas de evolución del paciente' },
      { h: 'Pestañas' },
      { list: [
        '**Consultas**: notas de evolución firmadas, con sus diagnósticos.',
        '**Historia clínica y alergias**: antecedentes por sección (NOM-004), grupo sanguíneo, CURP y alergias activas.',
        '**Recetas** emitidas.',
        '**Archivos**: estudios en PDF o imagen (plan Plus).',
        '**Bitácora**: quién consultó o modificó el expediente y cuándo.',
      ] },
      { h: 'Escribir una nota de evolución' },
      { img: 'nota-soap', alt: 'Formulario de nota de evolución con signos vitales y SOAP' },
      { steps: [
        'Toca **Nueva nota de evolución**.',
        'Captura los **signos vitales** que tomaste.',
        'Llena **S · Subjetivo**, **O · Objetivo**, **A · Análisis** y **P · Plan**.',
        'En **Diagnósticos (CIE-10)** escribe un código o palabra («J02», «faringitis») y elige el diagnóstico.',
        'Toca **Guardar y firmar**, o **Guardar borrador** para terminarla después.',
      ] },
      { tip: 'Una nota firmada queda con tu nombre, fecha y hora y **ya no se puede modificar ni borrar**. Para corregir o completar, usa **Agregar adenda**.' },
    ],
  },
  {
    slug: 'recetas', category: 'Pacientes y expediente',
    title: 'Recetas en PDF con código QR',
    summary: 'Emite recetas con tus datos y cédula; cualquier farmacia las verifica.',
    body: [
      { steps: [
        'En una nota firmada toca **Recetar** (o **Nueva receta** en la pestaña Recetas).',
        'Escribe cada medicamento: nombre genérico, presentación, dosis, vía, frecuencia y duración. Usa **+ Medicamento** para agregar más.',
        'Revisa el diagnóstico y agrega indicaciones generales.',
        'Toca **Emitir e imprimir**: se abre el PDF listo para imprimir o enviar.',
      ] },
      { p: 'La receta lleva tus datos, tu cédula y un **código QR**. Al escanearlo, la farmacia ve una página de Tepahti que confirma que la receta es auténtica, con los medicamentos y sólo las iniciales del paciente.' },
      { tip: 'Una receta emitida no se modifica. Si hubo un error, **anúlala** indicando el motivo y emite una nueva; la anulada aparece como no válida al verificarla.' },
    ],
  },

  // ------------------------------------------------------------------ Crece tu consulta
  {
    slug: 'directorio', category: 'Crece tu consulta',
    title: 'Aparece en el directorio de Tepahti',
    summary: 'Pacientes nuevos te encuentran por especialidad, padecimiento o zona, sin comisión.',
    body: [
      { img: 'directorio', alt: 'Resultados del directorio con precio, opiniones y próximos horarios', mobile: true },
      { steps: [
        'En **Clínica** activa **Aparecer en el directorio**.',
        'Completa en cada médico su especialidad y los padecimientos que atiende.',
        'Agrega colonia, ciudad y coordenadas a tus sedes para aparecer en «Cerca de mí».',
      ] },
      { p: 'En el directorio cada médico muestra precio, opiniones verificadas, aseguradoras y su próximo horario libre. El paciente reserva directo contigo; **Tepahti no cobra comisión por paciente**.' },
    ],
  },
  {
    slug: 'opiniones-verificadas', category: 'Crece tu consulta',
    title: 'Opiniones verificadas',
    summary: 'Sólo opinan pacientes con una cita atendida, una opinión por cita.',
    body: [
      { img: 'opiniones', alt: 'Pestaña Opiniones con las calificaciones de los pacientes' },
      { p: 'Con las opiniones activadas en **Clínica**, al marcar una cita como **Atendida** el paciente recibe una invitación para calificar puntualidad, trato e instalaciones y dejar un comentario. Las opiniones publicadas aparecen en tus páginas y en el directorio.' },
      { list: [
        '**Respuesta pública**: el médico o la clínica pueden responder a cada opinión.',
        '**Ocultar** requiere un motivo y se le avisa al paciente; puedes **volver a publicar** cuando quieras. Ninguna opinión se borra en silencio.',
      ] },
    ],
  },
  {
    slug: 'cobros-en-linea', category: 'Crece tu consulta',
    title: 'Cobros en línea y anticipos',
    summary: 'Cobra la consulta o un anticipo al reservar y reduce las inasistencias.',
    body: [
      { p: 'Disponible desde el plan **Clínica**. Se configura en **Clínica → Pagos en línea**:' },
      { list: [
        '**No cobrar en línea**: el paciente paga en la clínica.',
        '**Opcional**: el paciente puede pagar en línea al reservar o en la clínica.',
        '**Obligatorio**: la cita se confirma al pagar; el horario se aparta 35 minutos mientras paga.',
        '**Monto a cobrar**: porcentaje del precio (anticipo) o el total.',
        '**Reembolso si cancela con al menos** cierto número de horas de anticipación.',
        'Opcionalmente, **OXXO y transferencia SPEI** para citas con 3 días o más de anticipación.',
      ] },
      { p: 'Los pagos con tarjeta los procesa Stripe. En la pestaña **Pagos** ves cada cobro con su cita, su estado y el **neto a transferir a la clínica**.' },
    ],
  },
  {
    slug: 'videoconsultas', category: 'Crece tu consulta',
    title: 'Videoconsultas desde el navegador',
    summary: 'Sin instalar nada: sala privada por cita, sala de espera y consentimiento.',
    body: [
      { p: 'Disponible desde el plan **Clínica**. Marca **También por videoconsulta** en los servicios que quieras ofrecer a distancia; el paciente lo elige al reservar o recepción al agendar.' },
      { steps: [
        'El paciente recibe por correo el enlace a su sala privada. La sala abre **15 minutos antes** de la cita.',
        'Antes de entrar ambos prueban cámara y micrófono, y el paciente acepta el **consentimiento** para la consulta a distancia.',
        'Tú entras desde la agenda con **Iniciar videoconsulta**; te avisamos cuando el paciente está esperando.',
        'Al terminar, toca **Documentar en el expediente** y marca la cita como atendida.',
      ] },
      { tip: 'Usa un lugar privado y una buena conexión. Funciona en Chrome, Safari y Edge, en computadora o celular.' },
    ],
  },
  {
    slug: 'reportes', category: 'Crece tu consulta',
    title: 'Reportes: ocupación, inasistencias e ingresos',
    summary: 'Los números de tu clínica, por periodo, médico y sede.',
    body: [
      { img: 'reportes', alt: 'Reportes con citas, inasistencia, ocupación e ingresos' },
      { list: [
        '**Citas** atendidas y por atender, **inasistencia** y **cancelaciones** (quién canceló y con cuánta anticipación).',
        '**Ocupación de la agenda**: tiempo agendado contra horario disponible.',
        '**Pacientes nuevos y recurrentes** e **ingresos** de las citas atendidas, más lo cobrado en línea.',
        '**Origen de las citas**: recepción, tu página, tu sitio web, el directorio o Google.',
        '**Por médico**: citas, atendidas e inasistencia de cada uno.',
      ] },
      { p: 'Filtra por fechas, médico o sede, o usa **Este mes**, **Mes pasado** y **Últimos 7 días**. Con el plan **Plus** puedes **descargar en Excel o CSV**.' },
      { tip: 'Activa en **Clínica** el resumen semanal: cada lunes te llega por correo con las citas, inasistencias, ocupación e ingresos de la semana.' },
    ],
  },

  // ------------------------------------------------------------------ Cuenta y suscripción
  {
    slug: 'planes-y-facturas', category: 'Cuenta y suscripción',
    title: 'Planes, pagos y facturas',
    summary: 'Consultorio, Clínica y Plus; 14 días de prueba y factura CFDI 4.0.',
    body: [
      { list: [
        '**Consultorio** · $499 al mes: 1 médico, agenda y reservas en línea, recordatorios por correo, expediente y recetas, directorio y opiniones.',
        '**Clínica** · $1,299 al mes: hasta 5 médicos, todo lo anterior, recordatorios por WhatsApp, videoconsultas y cobro en línea.',
        '**Plus** · $2,499 al mes: hasta 15 médicos, todo lo anterior, estudios y archivos en el expediente y exportación de reportes a Excel.',
      ] },
      { p: 'Precios en pesos mexicanos con IVA incluido. Todos los planes empiezan con **14 días gratis**.' },
      { steps: [
        'En **Suscripción** elige tu plan y toca **Suscribirme** para capturar tu tarjeta.',
        'En **Datos para tu factura (CFDI 4.0)** captura RFC, nombre o razón social, régimen fiscal, código postal fiscal y uso del CFDI.',
        'En **Pagos y facturas** descargas cada factura en PDF y XML.',
      ] },
      { tip: 'Puedes cambiar de plan o de tarjeta cuando quieras desde la misma pestaña. Si un cobro falla, tu clínica sigue funcionando 7 días mientras actualizas la tarjeta.' },
    ],
  },
  {
    slug: 'calendario-y-avisos', category: 'Cuenta y suscripción',
    title: 'Conecta tu Google Calendar y activa los avisos',
    summary: 'Tus eventos personales bloquean la agenda y te avisamos de cada cita nueva.',
    body: [
      { h: 'Google Calendar' },
      { steps: [
        'Entra a **Mi cuenta** (tu perfil debe estar vinculado a un médico).',
        'En **Mi calendario** toca **Conectar** y autoriza con tu cuenta de Google.',
      ] },
      { list: [
        'Tus eventos personales **bloquean tu agenda** en Tepahti en segundos: nadie podrá reservar a esa hora.',
        'Tus citas de Tepahti **se copian a tu calendario**, con sus cambios y cancelaciones.',
      ] },
      { h: 'Avisos en tu celular o computadora' },
      { p: 'En **Mi cuenta → Avisos en este dispositivo** toca **Activar avisos**. Te avisamos cuando entra una cita en línea o un paciente cancela.' },
    ],
  },
  {
    slug: 'integraciones-api', category: 'Cuenta y suscripción',
    title: 'API y webhooks para otros sistemas',
    summary: 'Conecta Tepahti con tu CRM, tu sitio web o tu sistema contable.',
    body: [
      { img: 'integraciones', alt: 'Pestaña Integraciones con llaves de la API y webhooks' },
      { list: [
        '**Llaves de la API**: permiten consultar médicos, servicios, disponibilidad y citas, y opcionalmente agendar y cancelar. Trátalas como contraseñas.',
        '**Webhooks**: Tepahti avisa a tu sistema cuando se crea, reprograma, cancela, confirma, atiende o paga una cita. Cada aviso va firmado.',
      ] },
      { p: 'La documentación completa está en **Integraciones → Documentación de la API**.' },
    ],
  },

  // ------------------------------------------------------------------ Para pacientes
  {
    slug: 'como-agendar', category: 'Para pacientes',
    title: 'Cómo agendar una cita en línea',
    summary: 'Elige médico, servicio y horario, y confirma con tu cuenta.',
    body: [
      { img: 'reservar-horario', alt: 'Selección de fecha y hora en la página de reservas', mobile: true },
      { steps: [
        'Abre el enlace de tu clínica o busca a tu médico en el **directorio**.',
        'Elige médico y servicio, y toca un horario libre.',
        'Entra con tu cuenta o créala con tu nombre, teléfono, correo y contraseña. Confirma tu correo con el enlace que te enviamos.',
        'Toca **Confirmar cita**. Recibirás la confirmación por correo con un archivo para tu calendario.',
      ] },
    ],
  },
  {
    slug: 'mis-citas', category: 'Para pacientes',
    title: 'Mis citas: confirmar, reprogramar o cancelar',
    summary: 'Administra tus citas desde tu portal o desde el recordatorio.',
    body: [
      { img: 'portal-paciente', alt: 'Portal del paciente con sus próximas citas', mobile: true },
      { list: [
        'En **tepahti.nut.com.mx/paciente** ves tus **próximas citas** y tu **historial**.',
        'Puedes **reprogramar** o **cancelar** hasta el límite que fija tu clínica.',
        'El recordatorio que te llega antes de cada cita trae un enlace para **confirmar tu asistencia** o cancelar sin iniciar sesión.',
        'Si tu cita es por videoconsulta, entra con **Entrar a la videoconsulta**; la sala abre 15 minutos antes.',
        'Después de tu consulta puedes **calificarla**.',
      ] },
      { tip: 'Si no encuentras horario, anótate en la **lista de espera**: si se libera uno, te lo apartamos y te avisamos por correo.' },
    ],
  },
];

export const bySlug = (slug: string) => ARTICLES.find((a) => a.slug === slug);
