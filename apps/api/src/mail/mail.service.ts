import { Inject, Injectable } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService, Tx } from '../prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { buildIcs } from './ics';
import { OutgoingEmail } from './mail.transport';
import {
  AppointmentEmailKind, RenderedEmail, appointmentEmail, patientLinkRequest, resetPassword, staffInvitation, verifyEmail,
  onboardingSubmitted, ownerActivation, reviewInvitation, reviewModerated, waitlistOffer,
} from './templates';

/**
 * Arma los correos y los encola en la transacción del cambio que los origina.
 * Los tokens van en el fragmento (#) del enlace: no llegan a bitácoras del servidor ni al Referer.
 */
@Injectable()
export class MailService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly jobs: JobsService,
  ) {}

  link(path: string, token?: string): string {
    return `${this.config.webOrigin}${path}${token ? `#${token}` : ''}`;
  }

  async verifyEmail(tx: Tx | PrismaService, p: { email: string; name: string; token: string }) {
    await this.enqueue(tx, p.email, verifyEmail({ name: p.name, link: this.link('/verificar', p.token) }));
  }

  async passwordReset(tx: Tx | PrismaService, p: { email: string; name: string; token: string; audience: 'paciente' | 'personal' }) {
    const link = this.link(`/restablecer?tipo=${p.audience}`, p.token);
    await this.enqueue(tx, p.email, resetPassword({ name: p.name, link }));
  }

  async staffInvitation(tx: Tx | PrismaService, p: {
    email: string; name: string; clinicName: string; timezone: string; role: StaffRole; inviterName: string;
    token: string; expiresAt: Date;
  }) {
    const link = this.link('/invitacion', p.token);
    await this.enqueue(tx, p.email, staffInvitation({ ...p, link }));
  }

  async waitlistOffer(tx: Tx | PrismaService, p: { email: string; token: string } & Omit<Parameters<typeof waitlistOffer>[0], 'link'>) {
    const { email, token, ...data } = p;
    await this.enqueue(tx, email, waitlistOffer({ ...data, link: this.link('/lista-espera', token) }));
  }

  async patientLinkRequest(tx: Tx | PrismaService, p: { email: string; patientName: string; clinicName: string; token: string }) {
    await this.enqueue(tx, p.email, patientLinkRequest({
      patientName: p.patientName, clinicName: p.clinicName, link: this.link('/vincular', p.token),
    }));
  }

  async reviewInvitation(tx: Tx | PrismaService, p: { email: string; token: string } & Omit<Parameters<typeof reviewInvitation>[0], 'link'>) {
    const { email, token, ...data } = p;
    await this.enqueue(tx, email, reviewInvitation({ ...data, link: this.link('/opinion', token) }));
  }

  async reviewModerated(tx: Tx | PrismaService, p: { email: string } & Parameters<typeof reviewModerated>[0]) {
    const { email, ...data } = p;
    await this.enqueue(tx, email, reviewModerated(data));
  }

  /** Sin token: ya tenía cuenta de personal, el enlace lleva al inicio de sesión. */
  async ownerActivation(tx: Tx | PrismaService, p: { email: string; name: string; clinicName: string; slug: string; token: string | null }) {
    await this.enqueue(tx, p.email, ownerActivation({
      name: p.name, clinicName: p.clinicName, slug: p.slug, site: this.config.webOrigin, existing: p.token === null,
      link: p.token ? this.link('/restablecer?tipo=personal', p.token) : this.link(`/login?clinica=${encodeURIComponent(p.slug)}`),
    }));
  }

  async onboardingSubmitted(tx: Tx | PrismaService, p: { email: string } & Parameters<typeof onboardingSubmitted>[0]) {
    const { email, ...data } = p;
    await this.enqueue(tx, email, onboardingSubmitted(data));
  }

  /** Correo al paciente por un evento de su cita (creación, reprogramación o cancelación). */
  async appointmentEvent(tx: Tx, eventId: string): Promise<void> {
    const event = await tx.appointmentEvent.findUniqueOrThrow({
      where: { id: eventId },
      include: {
        appointment: {
          include: {
            clinic: true,
            location: true,
            doctor: { select: { displayName: true } },
            clinicPatient: { select: { name: true, email: true, patientAccountId: true } },
          },
        },
      },
    });
    if (event.type !== 'CREATED' && event.type !== 'RESCHEDULED' && event.type !== 'CANCELLED') return;
    const a = event.appointment;
    const to = a.clinicPatient.email;
    if (!to) return;
    const kind = event.type as AppointmentEmailKind;
    const startsAt = kind === 'CANCELLED' ? (event.fromStartsAt ?? a.startsAt) : (event.toStartsAt ?? a.startsAt);
    const endsAt = new Date(startsAt.getTime() + a.durationMinutes * 60_000);
    const rendered = appointmentEmail({
      kind,
      patientName: a.clinicPatient.name,
      clinic: {
        name: a.clinic.name, address: placeOf(a.location, a.clinic), phone: a.location.phone ?? a.clinic.phone,
        timezone: a.clinic.timezone,
      },
      doctorName: a.doctor.displayName,
      serviceName: a.serviceName,
      startsAt,
      previousStartsAt: event.fromStartsAt,
      priceCents: a.priceCents,
      reason: event.reason,
      portalLink: a.clinicPatient.patientAccountId ? this.link('/paciente') : null,
    });
    // La secuencia del evento de calendario crece con cada cambio de la cita.
    const sequence = await tx.appointmentEvent.count({
      where: { appointmentId: a.id, createdAt: { lte: event.createdAt }, id: { not: event.id } },
    });
    const ics = buildIcs({
      uid: `${a.id}@medora`,
      sequence,
      method: kind === 'CANCELLED' ? 'CANCEL' : 'PUBLISH',
      start: startsAt,
      end: endsAt,
      summary: `${a.serviceName} · ${a.doctor.displayName}`,
      location: [a.clinic.name, placeOf(a.location, a.clinic)].filter(Boolean).join(', '),
      description: a.clinic.phone ? `Teléfono de la clínica: ${a.clinic.phone}` : null,
      organizerEmail: this.fromAddress(),
      organizerName: a.clinic.name,
    });
    await this.enqueue(tx, to, rendered, {
      dedupeKey: `appointment-event:${event.id}`,
      messageId: `<${event.id}@medora>`,
      attachments: [{
        filename: kind === 'CANCELLED' ? 'cita-cancelada.ics' : 'cita.ics',
        contentType: `text/calendar; charset=utf-8; method=${kind === 'CANCELLED' ? 'CANCEL' : 'PUBLISH'}`,
        content: ics,
      }],
    });
  }

  private fromAddress(): string {
    const from = this.config.mail.from;
    return from.match(/<([^>]+)>/)?.[1] ?? from;
  }

  private async enqueue(
    tx: Tx | PrismaService, to: string, rendered: RenderedEmail,
    extra: Pick<OutgoingEmail, 'attachments' | 'messageId'> & { dedupeKey?: string } = {},
  ) {
    const { dedupeKey, ...rest } = extra;
    await this.jobs.enqueue(tx, { type: 'email.send', payload: { to, ...rendered, ...rest }, dedupeKey });
  }
}

/** Sede y dirección de la cita: «Sede Norte, Av. X 123» (la de la clínica si la sede no tiene). */
export function placeOf(location: { name: string; address: string | null }, clinic: { address: string | null }): string {
  return [location.name, location.address ?? clinic.address].filter(Boolean).join(', ');
}
