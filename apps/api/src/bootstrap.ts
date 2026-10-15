import 'reflect-metadata';
import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppConfig, loadConfig } from './config';
import { buildAppModule } from './app.module';
import { RateLimiter } from './common/rate-limit';
import { MailTransport } from './mail/mail.transport';

export async function createApp(
  config: AppConfig = loadConfig(), logger = true, mailTransport?: MailTransport,
): Promise<INestApplication> {
  RateLimiter.enabled = config.rateLimitEnabled ?? true;
  const app = await NestFactory.create<NestExpressApplication>(buildAppModule(config, mailTransport), {
    logger: logger ? ['error', 'warn', 'log'] : false,
  });
  // Un único salto de proxy (Nginx o el proxy de Next) para obtener la IP del cliente.
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
      exceptionFactory: (errors) => new BadRequestException(validationMessage(errors)),
    }),
  );
  app.enableShutdownHooks();
  return app;
}

const ES: Record<string, string> = {
  whitelistValidation: 'no es un campo permitido',
  isEmail: 'debe ser un correo electrónico válido',
  minLength: 'es demasiado corto',
  maxLength: 'es demasiado largo',
  isUuid: 'debe ser un identificador válido',
  isIso8601: 'debe ser una fecha válida',
  isInt: 'debe ser un número entero',
  min: 'es menor al mínimo permitido',
  max: 'es mayor al máximo permitido',
  isBoolean: 'debe ser verdadero o falso',
  isEnum: 'no es un valor permitido',
  isIn: 'no es un valor permitido',
  isArray: 'debe ser una lista',
  arrayMaxSize: 'tiene demasiados elementos',
  isString: 'debe ser texto',
  matches: 'tiene un formato inválido',
};

interface VError { property: string; constraints?: Record<string, string>; children?: VError[] }

/** Mensaje de validación en español; conserva los mensajes personalizados. */
function validationMessage(errors: VError[], prefix = ''): string {
  for (const e of errors) {
    const path = prefix ? `${prefix}.${e.property}` : e.property;
    if (e.constraints) {
      const [key, original] = Object.entries(e.constraints)[0];
      const custom = /[áéíóúñ]|inválido/i.test(original) && !original.includes(e.property);
      return custom ? original : `El campo «${path}» ${ES[key] ?? 'no es válido'}`;
    }
    if (e.children?.length) return validationMessage(e.children, path);
  }
  return 'Datos inválidos';
}
