export interface AppConfig {
  databaseUrl: string;
  jwtSecret: Uint8Array;
  webOrigin: string;
  cookieSecure: boolean;
  port: number;
  host: string;
  production: boolean;
  trustProxy: boolean;
  rateLimitEnabled?: boolean;
  mail: MailConfig;
  whatsapp: WhatsAppConfig | null;
  /** Stripe (cuenta de Medora). Sin llaves, los pagos en línea quedan desactivados. */
  payments: PaymentsConfig | null;
  /** Daily (videoconsultas). Sin llave, la telemedicina queda desactivada. */
  video: { apiKey: string } | null;
  /** Llave AES-256 (32 bytes) para cifrar los adjuntos del expediente. Sin ella no se aceptan adjuntos. */
  recordsKey: Buffer | null;
  /** Intervalo del trabajador de la cola; 0 lo desactiva (pruebas). */
  jobsPollMs: number;
}

/** WhatsApp Business Cloud API (Meta). Sin token, el canal queda desactivado. */
export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  /** Plantilla aprobada para el recordatorio y su idioma. */
  template: string;
  /** Plantilla aprobada para invitar a opinar tras una cita atendida. */
  reviewTemplate: string;
  language: string;
  apiVersion: string;
  /** Lada que se antepone a teléfonos de 10 dígitos. */
  defaultCountryCode: string;
}

export interface PaymentsConfig {
  secretKey: string;
  webhookSecret: string;
}

export interface MailConfig {
  from: string;
  /** Sin SMTP los correos se escriben en la bitácora (sólo fuera de producción). */
  smtp: { host: string; port: number; secure: boolean; user: string; password: string } | null;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Falta la variable de entorno ${name}`);
  return value.trim();
}

export function loadConfig(): AppConfig {
  const appEnv = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development';
  const production = appEnv === 'production';
  const jwtSecret = required('JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
  const webOrigin = required('WEB_ORIGIN');
  if (webOrigin.endsWith('/')) throw new Error('WEB_ORIGIN no debe terminar en /');
  const cookieSecure = (process.env.COOKIE_SECURE ?? (production ? 'true' : 'false')) === 'true';
  if (production && (!webOrigin.startsWith('https://') || !cookieSecure)) {
    throw new Error('En producción WEB_ORIGIN debe ser HTTPS y COOKIE_SECURE=true');
  }
  return {
    mail: loadMailConfig(production),
    whatsapp: loadWhatsAppConfig(),
    payments: loadPaymentsConfig(production),
    video: process.env.DAILY_API_KEY?.trim() ? { apiKey: process.env.DAILY_API_KEY.trim() } : null,
    recordsKey: loadRecordsKey(),
    jobsPollMs: Number(process.env.JOBS_POLL_MS ?? 2000),
    databaseUrl: required('DATABASE_URL'),
    jwtSecret: new TextEncoder().encode(jwtSecret),
    webOrigin,
    cookieSecure,
    port: Number(process.env.PORT ?? 6010),
    host: process.env.HOST ?? '127.0.0.1',
    production,
    trustProxy: (process.env.TRUST_PROXY ?? 'true') === 'true',
  };
}

function loadRecordsKey(): Buffer | null {
  const raw = process.env.RECORDS_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('RECORDS_ENCRYPTION_KEY debe ser 32 bytes en base64 (openssl rand -base64 32)');
  return key;
}

function loadPaymentsConfig(production: boolean): PaymentsConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return null;
  if (!/^(sk|rk)_(test|live)_/.test(secretKey)) throw new Error('STRIPE_SECRET_KEY no parece una llave de Stripe');
  if (!production && secretKey.includes('_live_')) throw new Error('Fuera de producción sólo se aceptan llaves de prueba de Stripe');
  const webhookSecret = required('STRIPE_WEBHOOK_SECRET');
  if (!webhookSecret.startsWith('whsec_')) throw new Error('STRIPE_WEBHOOK_SECRET debe empezar con whsec_');
  return { secretKey, webhookSecret };
}

function loadWhatsAppConfig(): WhatsAppConfig | null {
  const token = process.env.WHATSAPP_TOKEN?.trim();
  if (!token) return null;
  return {
    token,
    phoneNumberId: required('WHATSAPP_PHONE_NUMBER_ID'),
    template: process.env.WHATSAPP_TEMPLATE?.trim() || 'recordatorio_cita',
    reviewTemplate: process.env.WHATSAPP_REVIEW_TEMPLATE?.trim() || 'invitacion_opinion',
    language: process.env.WHATSAPP_TEMPLATE_LANG?.trim() || 'es_MX',
    apiVersion: process.env.WHATSAPP_API_VERSION?.trim() || 'v21.0',
    defaultCountryCode: process.env.WHATSAPP_DEFAULT_COUNTRY?.trim() || '52',
  };
}

function loadMailConfig(production: boolean): MailConfig {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) {
    if (production) throw new Error('En producción se requiere SMTP_HOST para enviar correos');
    return { from: process.env.MAIL_FROM?.trim() || 'Medora <no-reply@localhost>', smtp: null };
  }
  const port = Number(process.env.SMTP_PORT ?? 465);
  return {
    from: required('MAIL_FROM'),
    smtp: {
      host, port,
      secure: (process.env.SMTP_SECURE ?? (port === 465 ? 'true' : 'false')) === 'true',
      user: required('SMTP_USER'),
      password: required('SMTP_PASSWORD'),
    },
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
