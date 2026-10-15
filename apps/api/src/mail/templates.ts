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
    '', '— Medora',
  ].join('\n');

  const details = opts.details?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse">${opts.details
      .map((d) => `<tr><td style="padding:4px 16px 4px 0;color:#5b6472;vertical-align:top">${esc(d.label)}</td><td style="padding:4px 0;font-weight:600">${esc(d.value)}</td></tr>`)
      .join('')}</table>`
    : '';
  const action = opts.action
    ? `<p style="margin:24px 0"><a href="${esc(opts.action.url)}" style="background:#0f766e;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${esc(opts.action.label)}</a></p>
<p style="font-size:13px;color:#5b6472">Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all">${esc(opts.action.url)}</span></p>`
    : '';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(opts.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2530">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#ffffff;border-radius:12px;padding:28px 24px">
<p style="margin:0 0 20px;font-weight:700;color:#0f766e;font-size:18px">Medora</p>
<p style="margin:0 0 16px">${esc(opts.greeting)}</p>
${opts.paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.5">${esc(p)}</p>`).join('\n')}
${details}
${action}
${(opts.footer ?? []).map((f) => `<p style="margin:12px 0 0;font-size:13px;color:#5b6472;line-height:1.5">${esc(f)}</p>`).join('\n')}
</div>
<p style="text-align:center;font-size:12px;color:#8a93a0;margin:16px 0 0">Correo automático de Medora. No respondas a este mensaje.</p>
</div></body></html>`;
  return { subject: opts.subject, text, html };
}

export function verifyEmail(p: { name: string; link: string }): RenderedEmail {
  return layout({
    subject: 'Confirma tu correo en Medora',
    greeting: `Hola, ${p.name}:`,
    paragraphs: ['Gracias por crear tu cuenta. Confirma tu correo para poder reservar citas en línea.'],
    action: { label: 'Confirmar mi correo', url: p.link },
    footer: ['El enlace vence en 24 horas. Si no creaste esta cuenta, ignora este mensaje.'],
  });
}

export function resetPassword(p: { name: string; link: string }): RenderedEmail {
  return layout({
    subject: 'Restablece tu contraseña de Medora',
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
    subject: `Te invitaron a ${p.clinicName} en Medora`,
    greeting: `Hola, ${p.name}:`,
    paragraphs: [`${p.inviterName} te invitó a unirte al equipo de ${p.clinicName} en Medora.`],
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
    ...(p.clinic.address ? [{ label: 'Dirección', value: p.clinic.address }] : []),
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
    action: p.portalLink ? { label: 'Ver mis citas', url: p.portalLink } : undefined,
    footer,
  });
}
