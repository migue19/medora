import { StaffRole } from '@prisma/client';
import { DateTime } from 'luxon';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const ROLE_LABEL: Record<StaffRole, string> = {
  OWNER: 'Propietario', ADMIN: 'Administrador', RECEPTION: 'Recepción', DOCTOR: 'Médico',
};

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

interface Block { label: string; value: string }

// Logotipo servido por la web (PNG: muchos clientes de correo no muestran SVG). Sin origen, texto.
const ORIGIN = process.env.WEB_ORIGIN?.trim().replace(/\/$/, '');
const LOGO = ORIGIN?.startsWith('https://')
  ? `<img src="${ORIGIN}/brand/logo-email.png" width="114" height="36" alt="tepahti" style="display:block;border:0;height:36px;width:114px">`
  : '<span style="font-weight:800;color:#15211f;font-size:22px;letter-spacing:-0.5px">tepahti</span>';

/** Plantilla común: texto plano completo y HTML sencillo compatible con clientes de correo. */
function layout(opts: {
  subject: string; greeting: string; paragraphs: string[]; details?: Block[];
  action?: { label: string; url: string }; footer?: string[];
}): RenderedEmail {
  const text = [
    opts.greeting, '',
    ...opts.paragraphs.flatMap((p) => [p, '']),
    ...(opts.details?.length ? [...opts.details.map((d) => `${d.label}: ${d.value}`), ''] : []),
    ...(opts.action ? [`${opts.action.label}: ${opts.action.url}`, ''] : []),
    ...(opts.footer ?? []),
    '', '— Tepahti',
  ].join('\n');

  const details = opts.details?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse">${opts.details
      .map((d) => `<tr><td style="padding:4px 16px 4px 0;color:#5c6b68;vertical-align:top">${esc(d.label)}</td><td style="padding:4px 0;font-weight:600">${esc(d.value)}</td></tr>`)
      .join('')}</table>`
    : '';
  const action = opts.action
    ? `<p style="margin:24px 0"><a href="${esc(opts.action.url)}" style="background:#0b6e5f;color:#ffffff;padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">${esc(opts.action.label)}</a></p>
<p style="font-size:13px;color:#5c6b68">Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all">${esc(opts.action.url)}</span></p>`
    : '';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(opts.subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f5f0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#15211f">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#ffffff;border-radius:16px;padding:28px 24px;border:1px solid #dce3e0">
<div style="margin:0 0 22px">${LOGO}</div>
<p style="margin:0 0 16px">${esc(opts.greeting)}</p>
${opts.paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.5">${esc(p)}</p>`).join('\n')}
${details}
${action}
${(opts.footer ?? []).map((f) => `<p style="margin:12px 0 0;font-size:13px;color:#5c6b68;line-height:1.5">${esc(f)}</p>`).join('\n')}
</div>
<p style="text-align:center;font-size:12px;color:#687673;margin:16px 0 0">Correo automático de Tepahti. No respondas a este mensaje.</p>
</div></body></html>`;
  return { subject: opts.subject, text, html };
}

export function verifyEmail(p: { name: string; link: string }): RenderedEmail {
  return layout({
    subject: 'Confirma tu correo en Tepahti',
    greeting: `Hola, ${p.name}:`,
    paragraphs: ['Gracias por crear tu cuenta. Confirma tu correo para poder reservar citas en línea.'],
    action: { label: 'Confirmar mi correo', url: p.link },
    footer: ['El enlace vence en 24 horas. Si no creaste esta cuenta, ignora este mensaje.'],
  });
}

export function resetPassword(p: { name: string; link: string }): RenderedEmail {
  return layout({
    subject: 'Restablece tu contraseña de Tepahti',
    greeting: `Hola, ${p.name}:`,
    paragraphs: ['Recibimos una solicitud para restablecer tu contraseña. Al cambiarla se cerrarán todas tus sesiones.'],
    action: { label: 'Elegir una contraseña nueva', url: p.link },
    footer: ['El enlace vence en 30 minutos y sólo se puede usar una vez. Si no lo solicitaste, ignora este mensaje: tu contraseña no cambia.'],
  });
}

export function staffInvitation(p: {
  name: string; clinicName: string; role: StaffRole; inviterName: string; link: string; expiresAt: Date;
  timezone: string;
}): RenderedEmail {
  return layout({
    subject: `Te invitaron a ${p.clinicName} en Tepahti`,
    greeting: `Hola, ${p.name}:`,
    paragraphs: [`${p.inviterName} te invitó a unirte al equipo de ${p.clinicName} en Tepahti.`],
    details: [{ label: 'Rol', value: ROLE_LABEL[p.role] }, { label: 'Clínica', value: p.clinicName }],
    action: { label: 'Aceptar la invitación', url: p.link },
    footer: [`La invitación vence el ${DateTime.fromJSDate(p.expiresAt).setZone(p.timezone).setLocale('es').toFormat("d 'de' LLLL")}. Si no esperabas este correo, ignóralo.`],
  });
}

export type AppointmentEmailKind = 'CREATED' | 'RESCHEDULED' | 'CANCELLED';

export interface AppointmentEmailData {
  kind: AppointmentEmailKind;
  patientName: string;
  clinic: { name: string; address: string | null; phone: string | null; timezone: string };
  doctorName: string;
  serviceName: string;
  startsAt: Date;
  previousStartsAt?: Date | null;
  priceCents: number;
  reason?: string | null;
  /** Portal del paciente (sólo si tiene cuenta en línea). */
  portalLink?: string | null;
  /** Pago en línea recibido (confirmación tras pagar). */
  paidCents?: number | null;
  /** Al cancelar una cita pagada: monto que se reembolsa, o 0 si la política no lo permite. */
  refundCents?: number | null;
  /** Videoconsulta: enlace a la sala (en lugar de la dirección). */
  videoLink?: string | null;
}

export function formatWhen(date: Date, timezone: string): string {
  const d = DateTime.fromJSDate(date, { zone: timezone }).setLocale('es');
  return `${d.toFormat("cccc d 'de' LLLL 'de' yyyy")} a las ${d.toFormat('HH:mm')} h`;
}

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(cents / 100);
}

export function appointmentEmail(p: AppointmentEmailData): RenderedEmail {
  const when = formatWhen(p.startsAt, p.clinic.timezone);
  const subject = {
    CREATED: `Cita confirmada: ${when}`,
    RESCHEDULED: `Cita reprogramada: ${when}`,
    CANCELLED: `Cita cancelada: ${when}`,
  }[p.kind];
  const intro = {
    CREATED: `Tu cita en ${p.clinic.name} quedó agendada.`,
    RESCHEDULED: `Tu cita en ${p.clinic.name} cambió de horario.`,
    CANCELLED: `Tu cita en ${p.clinic.name} fue cancelada.`,
  }[p.kind];
  const details: Block[] = [
    { label: p.kind === 'CANCELLED' ? 'Era el' : 'Fecha', value: when },
    ...(p.kind === 'RESCHEDULED' && p.previousStartsAt
      ? [{ label: 'Antes', value: formatWhen(p.previousStartsAt, p.clinic.timezone) }] : []),
    { label: 'Médico', value: p.doctorName },
    { label: 'Servicio', value: p.serviceName },
    ...(p.kind !== 'CANCELLED' ? [{ label: 'Precio', value: formatPrice(p.priceCents) }] : []),
    ...(p.paidCents ? [{ label: 'Pagado en línea', value: formatPrice(p.paidCents) }] : []),
    ...(p.kind === 'CANCELLED' && p.refundCents != null
      ? [{ label: 'Reembolso', value: p.refundCents > 0 ? `${formatPrice(p.refundCents)} a tu método de pago (5 a 10 días hábiles)` : 'No aplica: se canceló fuera del plazo de reembolso de la clínica' }]
      : []),
    ...(p.videoLink ? [{ label: 'Modalidad', value: 'Videoconsulta (desde tu celular o computadora, sin instalar nada)' }]
      : p.clinic.address ? [{ label: 'Dirección', value: p.clinic.address }] : []),
    ...(p.clinic.phone ? [{ label: 'Teléfono', value: p.clinic.phone }] : []),
    ...(p.kind === 'CANCELLED' && p.reason ? [{ label: 'Motivo', value: p.reason }] : []),
  ];
  const footer = p.kind === 'CANCELLED'
    ? ['Si quieres otra cita, puedes reservar de nuevo en línea o comunicarte con la clínica.']
    : ['Adjuntamos un archivo de calendario para que agregues la cita.',
      p.portalLink
        ? 'Puedes reprogramar o cancelar desde tu portal de paciente, dentro del plazo que fija la clínica.'
        : 'Para reprogramar o cancelar, comunícate con la clínica.'];
  return layout({
    subject,
    greeting: `Hola, ${p.patientName}:`,
    paragraphs: [intro],
    details,
    action: p.videoLink && p.kind !== 'CANCELLED' ? { label: 'Entrar a la videoconsulta', url: p.videoLink }
      : p.portalLink ? { label: 'Ver mis citas', url: p.portalLink } : undefined,
    footer: p.videoLink && p.kind !== 'CANCELLED'
      ? [`La sala abre 15 minutos antes de la cita. Ten a la mano un lugar privado, buena conexión y cámara y micrófono.`, ...footer]
      : footer,
  });
}

export function reminderEmail(p: {
  patientName: string;
  clinic: { name: string; address: string | null; phone: string | null; timezone: string };
  doctorName: string;
  serviceName: string;
  startsAt: Date;
  link: string;
  /** Fecha límite para cancelar en línea; null si ya pasó. */
  cancelUntil: Date | null;
  /** Videoconsulta: enlace a la sala. */
  videoLink?: string | null;
}): RenderedEmail {
  const when = formatWhen(p.startsAt, p.clinic.timezone);
  return layout({
    subject: `Recordatorio de tu cita: ${when}`,
    greeting: `Hola, ${p.patientName}:`,
    paragraphs: [
      `Te recordamos tu cita en ${p.clinic.name}. Confírmanos si vas a asistir.`,
      ...(p.videoLink ? [`Es una videoconsulta. Entra aquí 15 minutos antes: ${p.videoLink}`] : []),
    ],
    details: [
      { label: 'Fecha', value: when },
      { label: 'Médico', value: p.doctorName },
      { label: 'Servicio', value: p.serviceName },
      ...(p.videoLink ? [{ label: 'Modalidad', value: 'Videoconsulta' }] : p.clinic.address ? [{ label: 'Dirección', value: p.clinic.address }] : []),
      ...(p.clinic.phone ? [{ label: 'Teléfono', value: p.clinic.phone }] : []),
    ],
    action: { label: 'Confirmar o cancelar', url: p.link },
    footer: [
      p.cancelUntil
        ? `Puedes cancelar desde el enlace hasta el ${formatWhen(p.cancelUntil, p.clinic.timezone)}. Después, comunícate con la clínica.`
        : 'Si no puedes asistir, comunícate con la clínica lo antes posible.',
      'El enlace sirve una sola vez y es personal: no lo compartas.',
    ],
  });
}

export function waitlistOffer(p: {
  patientName: string;
  clinic: { name: string; address: string | null; phone: string | null; timezone: string };
  doctorName: string;
  serviceName: string;
  startsAt: Date;
  expiresAt: Date;
  link: string;
}): RenderedEmail {
  const when = formatWhen(p.startsAt, p.clinic.timezone);
  const until = DateTime.fromJSDate(p.expiresAt, { zone: p.clinic.timezone }).setLocale('es').toFormat("HH:mm 'h del' cccc d");
  return layout({
    subject: `Se liberó un horario: ${when}`,
    greeting: `Hola, ${p.patientName}:`,
    paragraphs: [
      `Estás en la lista de espera de ${p.clinic.name} y se liberó un horario. Lo apartamos para ti hasta las ${until}.`,
    ],
    details: [
      { label: 'Fecha', value: when },
      { label: 'Médico', value: p.doctorName },
      { label: 'Servicio', value: p.serviceName },
      ...(p.clinic.address ? [{ label: 'Dirección', value: p.clinic.address }] : []),
    ],
    action: { label: 'Ver y aceptar el horario', url: p.link },
    footer: [
      'Si no te sirve, puedes rechazarlo desde el mismo enlace y seguirás en la lista para el siguiente horario.',
      'Si no respondes a tiempo, se ofrecerá a la siguiente persona.',
    ],
  });
}

export function patientLinkRequest(p: {
  patientName: string; clinicName: string; link: string;
}): RenderedEmail {
  return layout({
    subject: `${p.clinicName} quiere vincular tu expediente con tu cuenta de Tepahti`,
    greeting: `Hola, ${p.patientName}:`,
    paragraphs: [
      `${p.clinicName} tiene una ficha tuya de citas agendadas por teléfono y quiere unirla con tu cuenta de Tepahti.`,
      'Al confirmar verás todas tus citas de esa clínica en «Mis citas» y podrás gestionarlas en línea.',
    ],
    action: { label: 'Confirmar vinculación', url: p.link },
    footer: ['El enlace vence en 7 días. Si no reconoces esta clínica, ignora este mensaje.'],
  });
}

export function reviewInvitation(p: {
  patientName: string; clinicName: string; doctorName: string; when: string; link: string;
}): RenderedEmail {
  return layout({
    subject: `¿Cómo fue tu consulta con ${p.doctorName}?`,
    greeting: `Hola, ${p.patientName}:`,
    paragraphs: [
      `Gracias por tu visita a ${p.clinicName}. Tu opinión ayuda a otros pacientes y a la clínica a mejorar.`,
      'Te toma un minuto: califica puntualidad, trato e instalaciones y, si quieres, deja un comentario.',
    ],
    details: [{ label: 'Médico', value: p.doctorName }, { label: 'Cita', value: p.when }],
    action: { label: 'Dejar mi opinión', url: p.link },
    footer: [
      'Sólo publicamos opiniones de citas atendidas. Puedes publicar con tu nombre de pila e inicial, o como «Paciente verificado».',
      'El enlace es personal y vence en 30 días.',
    ],
  });
}

export function reviewModerated(p: {
  patientName: string; clinicName: string; doctorName: string; hidden: boolean; reason: string; note: string | null;
}): RenderedEmail {
  return layout({
    subject: p.hidden ? `Tu opinión sobre ${p.doctorName} fue ocultada` : `Tu opinión sobre ${p.doctorName} volvió a publicarse`,
    greeting: `Hola, ${p.patientName}:`,
    paragraphs: [
      p.hidden
        ? `${p.clinicName} ocultó tu opinión de su página pública. No se borró: queda guardada junto con el motivo.`
        : `${p.clinicName} volvió a publicar tu opinión en su página.`,
    ],
    details: [
      ...(p.hidden ? [{ label: 'Motivo', value: p.reason }] : []),
      ...(p.note ? [{ label: 'Nota de la clínica', value: p.note }] : []),
    ],
    footer: ['Si crees que es un error, comunícate con la clínica.'],
  });
}

export function ownerActivation(p: { name: string; clinicName: string; slug: string; link: string; site: string; existing: boolean }): RenderedEmail {
  return layout({
    subject: p.existing ? `${p.clinicName} ya está en Tepahti` : `${p.clinicName} ya está en Tepahti: activa tu cuenta`,
    greeting: `Hola, ${p.name}:`,
    paragraphs: [
      p.existing
        ? `Cargamos la información de ${p.clinicName} y eres su propietario. Entra con tu correo y tu contraseña de Tepahti.`
        : `Cargamos la información de ${p.clinicName}. Eres la persona propietaria de la cuenta: elige tu contraseña para entrar al panel.`,
      `Para iniciar sesión usa el identificador de clínica «${p.slug}». Tu página de reservas es ${p.site}/c/${p.slug}.`,
    ],
    action: { label: p.existing ? 'Entrar al panel' : 'Elegir mi contraseña', url: p.link },
    footer: p.existing
      ? ['El resto del equipo recibirá su propia invitación.']
      : ['El enlace vence en 7 días y sirve una sola vez. El resto del equipo recibirá su propia invitación.'],
  });
}

export function onboardingSubmitted(p: { label: string; clinicName: string; contact: string; id: string }): RenderedEmail {
  return layout({
    subject: `Alta enviada: ${p.clinicName || p.label}`,
    greeting: 'Hola:',
    paragraphs: [`${p.clinicName || p.label} terminó de llenar el alta de Tepahti y la envió para revisión.`],
    details: [{ label: 'Contacto', value: p.contact || 'sin dato' }, { label: 'Alta', value: p.id }],
    footer: ['Revísala e impórtala con el comando del alta (README, sección «Alta de clínicas»).'],
  });
}

export function refundEmail(p: {
  patientName: string; clinicName: string; amountCents: number; startsAt: Date; timezone: string; serviceName: string;
}): RenderedEmail {
  return layout({
    subject: `Reembolso de ${formatPrice(p.amountCents)} · ${p.clinicName}`,
    greeting: `Hola, ${p.patientName}:`,
    paragraphs: [`Reembolsamos ${formatPrice(p.amountCents)} del pago de tu cita en ${p.clinicName}.`],
    details: [
      { label: 'Cita', value: `${p.serviceName} · ${formatWhen(p.startsAt, p.timezone)}` },
      { label: 'Monto', value: formatPrice(p.amountCents) },
    ],
    footer: ['El reembolso aparece en tu estado de cuenta en 5 a 10 días hábiles, según tu banco.'],
  });
}

export function subscriptionInvoiceEmail(p: {
  clinicName: string; planName: string; amountCents: number; periodStart: Date; periodEnd: Date; uuid: string | null; panelLink: string;
}): RenderedEmail {
  const fmt = (d: Date) => DateTime.fromJSDate(d, { zone: 'America/Mexico_City' }).setLocale('es').toFormat("d 'de' LLLL 'de' yyyy");
  return layout({
    subject: `Tu factura de Tepahti · ${formatPrice(p.amountCents)}`,
    greeting: `Hola, equipo de ${p.clinicName}:`,
    paragraphs: ['Gracias por tu pago. Adjuntamos la factura (CFDI 4.0) en PDF y XML.'],
    details: [
      { label: 'Plan', value: p.planName },
      { label: 'Periodo', value: `${fmt(p.periodStart)} al ${fmt(p.periodEnd)}` },
      { label: 'Total', value: `${formatPrice(p.amountCents)} (IVA incluido)` },
      ...(p.uuid ? [{ label: 'Folio fiscal', value: p.uuid }] : []),
    ],
    action: { label: 'Ver mi suscripción', url: p.panelLink },
    footer: ['También puedes descargar tus facturas en el panel, en «Suscripción».'],
  });
}

export function signupNotice(p: { clinicName: string; ownerName: string; email: string; doctorName: string; licenseNumber: string; adminLink: string }): RenderedEmail {
  return layout({
    subject: `Nueva clínica por verificar: ${p.clinicName}`,
    greeting: 'Hola:',
    paragraphs: ['Se registró una clínica nueva. Revisa la cédula en el Registro Nacional de Profesionistas y apruébala o recházala.'],
    details: [
      { label: 'Clínica', value: p.clinicName }, { label: 'Responsable', value: `${p.ownerName} <${p.email}>` },
      { label: 'Médico', value: p.doctorName }, { label: 'Cédula', value: p.licenseNumber },
    ],
    action: { label: 'Revisar en Tepahti', url: p.adminLink },
  });
}

export function verificationResult(p: { clinicName: string; approved: boolean; note: string | null; panelLink: string }): RenderedEmail {
  return layout({
    subject: p.approved ? `${p.clinicName} quedó verificada en Tepahti` : `Revisión de cédula de ${p.clinicName}`,
    greeting: 'Hola:',
    paragraphs: [p.approved
      ? 'Verificamos la cédula profesional. Ya puedes aparecer en el directorio de Tepahti y cobrar en línea.'
      : `No pudimos verificar la cédula profesional${p.note ? `: ${p.note}` : '.'} Corrígela en «Médicos» o responde a este correo.`],
    action: { label: 'Ir al panel', url: p.panelLink },
  });
}

export function signupActivation(p: { name: string; clinicName: string; slug: string; link: string; trialDays: number; planName: string }): RenderedEmail {
  return layout({
    subject: `Activa tu cuenta de Tepahti · ${p.clinicName}`,
    greeting: `Hola, ${p.name}:`,
    paragraphs: [
      `Registramos ${p.clinicName} con el plan ${p.planName} y ${p.trialDays} días de prueba sin costo. Elige tu contraseña para entrar al panel.`,
      `Para iniciar sesión usa el identificador de clínica «${p.slug}».`,
      'Mientras verificamos la cédula profesional (normalmente en un día hábil) ya puedes configurar tu agenda y recibir citas.',
    ],
    action: { label: 'Elegir mi contraseña', url: p.link },
    footer: ['El enlace vence en 7 días y sirve una sola vez. Si no fuiste tú, ignora este correo.'],
  });
}

export function accountExists(p: { name: string; loginLink: string; recoverLink: string }): RenderedEmail {
  return layout({
    subject: 'Ya tienes una cuenta en Tepahti',
    greeting: `Hola, ${p.name}:`,
    paragraphs: [
      'Alguien intentó registrar una clínica nueva con tu correo, que ya tiene cuenta en Tepahti. No creamos nada.',
      `Si fuiste tú, entra al panel con tu contraseña. Si la olvidaste, recupérala aquí: ${p.recoverLink}. Para abrir otra clínica con el mismo correo, responde a este mensaje.`,
    ],
    action: { label: 'Entrar al panel', url: p.loginLink },
    footer: ['Si no fuiste tú, ignora este correo.'],
  });
}

export interface WeeklyMetric { label: string; value: string; previous: string | null }

export function weeklyReportEmail(p: { clinicName: string; weekLabel: string; metrics: WeeklyMetric[]; topDoctor: string | null; link: string }): RenderedEmail {
  return layout({
    subject: `Tu semana en ${p.clinicName}: ${p.metrics[0]?.value ?? ''} citas`,
    greeting: 'Hola:',
    paragraphs: [`Este es el resumen de ${p.clinicName} del ${p.weekLabel}, comparado con la semana anterior.`],
    details: p.metrics.map((m) => ({ label: m.label, value: m.previous !== null ? `${m.value} (antes ${m.previous})` : m.value })),
    action: { label: 'Ver reportes', url: p.link },
    footer: [
      ...(p.topDoctor ? [`Mayor ocupación: ${p.topDoctor}.`] : []),
      'Puedes dejar de recibir este resumen en «Clínica» del panel.',
    ],
  });
}
