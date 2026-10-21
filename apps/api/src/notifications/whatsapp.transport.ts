import { WhatsAppConfig } from '../config';

export interface WhatsAppTemplateMessage {
  /** Número en formato internacional, sólo dígitos (p. ej. 5215512345678). */
  to: string;
  /** Parámetros del cuerpo de la plantilla, en orden ({{1}}, {{2}}…). */
  bodyParams: string[];
  /** Sufijo del botón de URL dinámica (el token del enlace). */
  buttonParam: string;
  /** Plantilla a usar; por omisión la del recordatorio. */
  template?: string;
}

export interface WhatsAppTransport {
  readonly configured: boolean;
  sendTemplate(message: WhatsAppTemplateMessage): Promise<{ id: string }>;
}

export const WHATSAPP_TRANSPORT = Symbol('WHATSAPP_TRANSPORT');

/** Envío por la Cloud API de WhatsApp Business. La plantilla debe estar aprobada por Meta. */
export class CloudApiWhatsApp implements WhatsAppTransport {
  readonly configured = true;

  constructor(private readonly config: WhatsAppConfig) {}

  async sendTemplate(m: WhatsAppTemplateMessage): Promise<{ id: string }> {
    const url = `https://graph.facebook.com/${this.config.apiVersion}/${encodeURIComponent(this.config.phoneNumberId)}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.token}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: m.to,
        type: 'template',
        template: {
          name: m.template ?? this.config.template,
          language: { code: this.config.language },
          components: [
            { type: 'body', parameters: m.bodyParams.map((text) => ({ type: 'text', text })) },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: m.buttonParam }] },
          ],
        },
      }),
    });
    const body = (await res.json().catch(() => null)) as
      | { messages?: { id: string }[]; error?: { message?: string; code?: number } }
      | null;
    if (!res.ok || !body?.messages?.[0]?.id) {
      throw new Error(`WhatsApp ${res.status}: ${body?.error?.message ?? 'respuesta inesperada'}`);
    }
    return { id: body.messages[0].id };
  }
}

/** Sin credenciales: el canal no está disponible. */
export class DisabledWhatsApp implements WhatsAppTransport {
  readonly configured = false;

  async sendTemplate(): Promise<{ id: string }> {
    throw new Error('WhatsApp no está configurado');
  }
}

/** Pruebas: guarda los mensajes en memoria. */
export class MemoryWhatsApp implements WhatsAppTransport {
  readonly configured = true;
  readonly sent: WhatsAppTemplateMessage[] = [];
  failNext = 0;

  async sendTemplate(m: WhatsAppTemplateMessage): Promise<{ id: string }> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('Fallo simulado de WhatsApp');
    }
    this.sent.push(m);
    return { id: `wamid.${this.sent.length}` };
  }
}

export function createWhatsApp(config: WhatsAppConfig | null): WhatsAppTransport {
  return config ? new CloudApiWhatsApp(config) : new DisabledWhatsApp();
}

/** Convierte un teléfono capturado libremente a dígitos internacionales. Devuelve null si no es válido. */
export function toWhatsAppNumber(phone: string, defaultCountryCode: string): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits.length >= 10 && digits.length <= 15 ? digits : null;
  if (digits.length === 10) return `${defaultCountryCode}${digits}`;
  if (digits.length > 10 && digits.length <= 15) return digits;
  return null;
}
