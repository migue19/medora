import { Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { MailConfig } from '../config';

export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: string;
  /** Contenido binario (PDF, XML de un CFDI) codificado en base64. */
  encoding?: 'base64';
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
  /** Message-ID estable: si un reintento llega a duplicarse, el cliente de correo puede agruparlo. */
  messageId?: string;
}

export interface MailTransport {
  send(email: OutgoingEmail): Promise<void>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export class SmtpTransport implements MailTransport {
  private readonly transporter: Transporter;

  constructor(private readonly config: MailConfig & { smtp: NonNullable<MailConfig['smtp']> }) {
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      requireTLS: !config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.password },
      // Muy por debajo del arrendamiento del trabajo (5 min) para no enviar dos veces.
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 60_000,
    });
  }

  async send(email: OutgoingEmail): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      messageId: email.messageId,
      attachments: email.attachments?.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content, encoding: a.encoding })),
    });
  }
}

/** Desarrollo sin SMTP: escribe el correo en la bitácora para poder seguir los enlaces. */
export class LogTransport implements MailTransport {
  private readonly logger = new Logger('Correo');

  async send(email: OutgoingEmail): Promise<void> {
    this.logger.log(`Para: ${email.to} · ${email.subject}\n${email.text}`);
  }
}

/** Pruebas: guarda los correos en memoria. */
export class MemoryTransport implements MailTransport {
  readonly sent: OutgoingEmail[] = [];
  failNext = 0;

  async send(email: OutgoingEmail): Promise<void> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('Fallo simulado del servidor SMTP');
    }
    this.sent.push(email);
  }
}

export function createTransport(config: MailConfig): MailTransport {
  return config.smtp ? new SmtpTransport({ ...config, smtp: config.smtp }) : new LogTransport();
}
