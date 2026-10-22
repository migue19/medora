import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NotificationChannel, Prisma } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService, Tx } from '../prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { MAIL_TRANSPORT, MailTransport } from '../mail/mail.transport';
import { formatWhen, reminderEmail } from '../mail/templates';
import { placeOf } from '../mail/mail.service';
import { randomToken, sha256 } from '../common/crypto';
import { WHATSAPP_TRANSPORT, WhatsAppTransport, toWhatsAppNumber } from './whatsapp.transport';
import { videoLinkToken } from '../video/link';

export const REMINDER_JOB = 'reminder.send';
/** No se programa un recordatorio que debería salir en menos de este margen. */
const MIN_LEAD_MS = 60_000;

interface ReminderPayload {
  appointmentId: string;
  channel: NotificationChannel;
  offsetMinutes: number;
  /** Horario con que se programó: si la cita se reprograma, este recordatorio ya no aplica. */
  startsAt: string;
}

/**
 * Recordatorios antes de la cita. Se programan como trabajos de la cola al reservar o reprogramar;
 * al enviarse vuelven a comprobar el estado de la cita, así que una cancelación o un cambio de último
 * minuto los anula. La bitácora con índice único por (cita, canal, anticipación, horario) evita duplicados.
 */
@Injectable()
export class RemindersService implements OnModuleInit {
  private readonly logger = new Logger('Recordatorios');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    @Inject(MAIL_TRANSPORT) private readonly mail: MailTransport,
    @Inject(WHATSAPP_TRANSPORT) private readonly whatsapp: WhatsAppTransport,
  ) {}

  onModuleInit(): void {
    this.jobs.register(REMINDER_JOB, (payload) => this.deliver(payload as unknown as ReminderPayload));
  }

  /** Programa los recordatorios de una cita (dentro de la transacción que la crea o reprograma). */
  async schedule(
    tx: Tx,
    appointment: { id: string; startsAt: Date },
    clinic: { remindersEnabled: boolean; reminderOffsets: number[]; whatsappEnabled: boolean },
    now = new Date(),
  ): Promise<void> {
    if (!clinic.remindersEnabled) return;
    const channels: NotificationChannel[] = clinic.whatsappEnabled ? ['EMAIL', 'WHATSAPP'] : ['EMAIL'];
    for (const offsetMinutes of clinic.reminderOffsets) {
      const runAt = new Date(appointment.startsAt.getTime() - offsetMinutes * 60_000);
      if (runAt.getTime() - now.getTime() < MIN_LEAD_MS) continue;
      for (const channel of channels) {
        const payload: ReminderPayload = {
          appointmentId: appointment.id, channel, offsetMinutes, startsAt: appointment.startsAt.toISOString(),
        };
        await this.jobs.enqueue(tx, {
          type: REMINDER_JOB, payload, runAt,
          dedupeKey: `reminder:${appointment.id}:${payload.startsAt}:${offsetMinutes}:${channel}`,
        });
      }
    }
  }

  async deliver(p: ReminderPayload): Promise<void> {
    const a = await this.prisma.appointment.findUnique({
      where: { id: p.appointmentId },
      include: {
        clinic: true,
        location: true,
        doctor: { select: { displayName: true } },
        clinicPatient: { include: { patientAccount: { select: { whatsappConsentAt: true } } } },
      },
    });
    const now = new Date();
    // Cancelada, reprogramada, ya iniciada o la clínica cambió su configuración: no se envía nada.
    if (
      !a || a.status !== 'BOOKED' || a.startsAt.toISOString() !== p.startsAt || a.startsAt <= now ||
      !a.clinic.remindersEnabled || !a.clinic.reminderOffsets.includes(p.offsetMinutes) ||
      (p.channel === 'WHATSAPP' && !a.clinic.whatsappEnabled)
    ) {
      return;
    }
    const key = { appointmentId: a.id, channel: p.channel, offsetMinutes: p.offsetMinutes, startsAt: a.startsAt };
    if (await this.prisma.notificationLog.count({ where: { ...key, status: 'SENT' } })) return;

    const base = { ...key, clinicId: a.clinicId, kind: 'REMINDER' };
    const skip = async (recipient: string | null, reason: string) => {
      if (await this.prisma.notificationLog.count({ where: { ...key, status: 'SKIPPED' } })) return;
      await this.prisma.notificationLog.create({ data: { ...base, status: 'SKIPPED', recipient, error: reason } });
    };

    let recipient: string | null;
    if (p.channel === 'EMAIL') {
      recipient = a.clinicPatient.email;
      if (!recipient) return skip(null, 'La ficha del paciente no tiene correo');
    } else {
      const consent = a.clinicPatient.patientAccount?.whatsappConsentAt ?? a.clinicPatient.whatsappConsentAt;
      if (!consent) return skip(a.clinicPatient.phone, 'Sin consentimiento para WhatsApp');
      if (!this.whatsapp.configured || !this.config.whatsapp) return skip(a.clinicPatient.phone, 'WhatsApp no está configurado');
      recipient = toWhatsAppNumber(a.clinicPatient.phone, this.config.whatsapp.defaultCountryCode);
      if (!recipient) return skip(a.clinicPatient.phone, 'Teléfono no válido para WhatsApp');
    }

    // Token del enlace: se genera al enviar, así nunca se guarda en claro.
    const token = randomToken();
    await this.prisma.appointmentActionToken.create({
      data: { appointmentId: a.id, tokenHash: sha256(token), startsAt: a.startsAt, expiresAt: a.startsAt },
    });

    try {
      let providerId: string | null = null;
      if (p.channel === 'EMAIL') {
        const cancelUntil = new Date(a.startsAt.getTime() - a.clinic.patientCancelMinMinutes * 60_000);
        const rendered = reminderEmail({
          patientName: a.clinicPatient.name,
          clinic: {
            name: a.clinic.name, address: placeOf(a.location, a.clinic), phone: a.location.phone ?? a.clinic.phone,
            timezone: a.clinic.timezone,
          },
          doctorName: a.doctor.displayName,
          serviceName: a.serviceName,
          startsAt: a.startsAt,
          link: `${this.config.webOrigin}/cita#${token}`,
          cancelUntil: cancelUntil > now ? cancelUntil : null,
          videoLink: a.modality === 'VIDEO' ? `${this.config.webOrigin}/consulta#${videoLinkToken(this.config.jwtSecret, a.id)}` : null,
        });
        await this.mail.send({
          to: recipient, ...rendered, messageId: `<reminder-${a.id}-${p.offsetMinutes}-${a.startsAt.getTime()}@medora>`,
        });
      } else {
        const sent = await this.whatsapp.sendTemplate({
          to: recipient,
          bodyParams: [a.clinicPatient.name, a.clinic.name, formatWhen(a.startsAt, a.clinic.timezone), a.doctor.displayName],
          buttonParam: token,
        });
        providerId = sent.id;
      }
      await this.prisma.notificationLog.create({ data: { ...base, status: 'SENT', recipient, providerId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
      const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      this.logger.warn(`Recordatorio ${p.channel} de la cita ${a.id} falló: ${error}`);
      await this.prisma.notificationLog.create({ data: { ...base, status: 'FAILED', recipient, error } });
      throw e;
    }
  }
}
