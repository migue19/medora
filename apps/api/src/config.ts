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
  /** Intervalo del trabajador de la cola; 0 lo desactiva (pruebas). */
  jobsPollMs: number;
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
