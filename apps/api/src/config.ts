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

export const APP_CONFIG = Symbol('APP_CONFIG');
