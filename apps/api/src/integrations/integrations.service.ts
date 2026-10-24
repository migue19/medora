import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { sha256 } from '../common/crypto';
import { APPOINTMENT_API_INCLUDE, WEBHOOK_EVENTS, WEBHOOK_TYPES, apiAppointment } from './serialize';
import { WEBHOOK_TRANSPORT, WebhookTransport } from './webhook.transport';
import { PushService } from './push.service';

export const OUTBOUND_JOB = 'appointment.outbound';
export const WEBHOOK_JOB = 'webhook.deliver';
export const CALENDAR_PUSH_JOB = 'calendar.push';
/** Tras tantos envíos fallidos seguidos, el destino se pausa (se reactiva desde el panel). */
const MAX_FAILURES = 50;

export interface ApiClient { keyId: string; clinicId: string; name: string; scopes: string[] }

/** Llaves de la API pública, webhooks de citas y el reparto de cada evento de cita hacia fuera. */
@Injectable()
export class IntegrationsService implements OnModuleInit {
  constructor(
    @Inject(WEBHOOK_TRANSPORT) private readonly transport: WebhookTransport,
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly push: PushService,
  ) {}

  onModuleInit() {
    this.jobs.register(OUTBOUND_JOB, (p) => this.outbound((p as { eventId: string }).eventId));
    this.jobs.register(WEBHOOK_JOB, (p) => this.deliver((p as { deliveryId: string }).deliveryId));
  }

  // ---------------------------------------------------------------- llaves

  async createKey(clinicId: string, createdById: string, name: string, scopes: string[]) {
    const secret = `mdr_${randomBytes(24).toString('base64url')}`;
    const key = await this.prisma.apiKey.create({
      data: { clinicId, name, scopes, createdById, prefix: secret.slice(0, 12), keyHash: sha256(secret) },
    });
    return { id: key.id, name: key.name, prefix: key.prefix, scopes: key.scopes, createdAt: key.createdAt, secret };
  }

  listKeys(clinicId: string) {
    return this.prisma.apiKey.findMany({
      where: { clinicId }, orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, revokedAt: true, createdAt: true },
    });
  }

  async revokeKey(clinicId: string, id: string) {
    const r = await this.prisma.apiKey.updateMany({ where: { id, clinicId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw new NotFoundException('Llave no encontrada');
  }

  /** Autentica una llave (Authorization: Bearer mdr_…). */
  async authenticate(secret: string): Promise<ApiClient | null> {
    if (!/^mdr_[A-Za-z0-9_-]{32}$/.test(secret)) return null;
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: sha256(secret) } });
    if (!key || key.revokedAt) return null;
    const clinic = await this.prisma.clinic.findUnique({ where: { id: key.clinicId } });
    if (!clinic?.active) return null;
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
      await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    }
    return { keyId: key.id, clinicId: key.clinicId, name: key.name, scopes: key.scopes };
  }

  // ---------------------------------------------------------------- webhooks

  async createEndpoint(clinicId: string, url: string, events: string[]) {
    if (events.some((e) => !WEBHOOK_EVENTS.includes(e))) throw new BadRequestException('Tipo de evento desconocido');
    try { await this.transport.validate(url); } catch (e) { throw new BadRequestException(e instanceof Error ? e.message : 'URL inválida'); }
    if (await this.prisma.webhookEndpoint.count({ where: { clinicId } }) >= 10) throw new ConflictException('Máximo 10 webhooks por clínica');
    return this.prisma.webhookEndpoint.create({
      data: { clinicId, url, events: events.length ? events : WEBHOOK_EVENTS, secret: `whsec_${randomBytes(24).toString('base64url')}` },
    });
  }

  async listEndpoints(clinicId: string) {
    const rows = await this.prisma.webhookEndpoint.findMany({
      where: { clinicId }, orderBy: { createdAt: 'desc' },
      include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    return rows.map((e) => ({
      id: e.id, url: e.url, events: e.events, active: e.active, failureCount: e.failureCount, createdAt: e.createdAt,
      secret: e.secret,
      deliveries: e.deliveries.map((d) => ({ id: d.id, type: d.type, status: d.status, attempts: d.attempts, responseCode: d.responseCode, lastError: d.lastError, createdAt: d.createdAt, deliveredAt: d.deliveredAt })),
    }));
  }

  async updateEndpoint(clinicId: string, id: string, data: { active?: boolean; events?: string[] }) {
    if (data.events?.some((e) => !WEBHOOK_EVENTS.includes(e))) throw new BadRequestException('Tipo de evento desconocido');
    const r = await this.prisma.webhookEndpoint.updateMany({
      where: { id, clinicId }, data: { ...data, ...(data.active ? { failureCount: 0 } : {}) },
    });
    if (!r.count) throw new NotFoundException('Webhook no encontrado');
  }

  async deleteEndpoint(clinicId: string, id: string) {
    const e = await this.prisma.webhookEndpoint.findFirst({ where: { id, clinicId } });
    if (!e) throw new NotFoundException('Webhook no encontrado');
    await this.prisma.$transaction([
      this.prisma.webhookDelivery.deleteMany({ where: { endpointId: id } }),
      this.prisma.webhookEndpoint.delete({ where: { id } }),
    ]);
  }

  /** Envía un evento de prueba (`ping`) al destino, sin pasar por la cola. */
  async ping(clinicId: string, id: string) {
    const e = await this.prisma.webhookEndpoint.findFirst({ where: { id, clinicId } });
    if (!e) throw new NotFoundException('Webhook no encontrado');
    const body = JSON.stringify({ id: `ping_${Date.now()}`, type: 'ping', createdAt: new Date().toISOString(), data: {} });
    try {
      const r = await this.transport.post({ url: e.url, headers: this.headers(e.secret, body, 'ping', 'ping'), body });
      return { ok: r.status >= 200 && r.status < 300, status: r.status };
    } catch (err) {
      return { ok: false, status: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Firma: HMAC-SHA256 de «timestamp.cuerpo» con el secreto del destino (como Stripe). */
  headers(secret: string, body: string, type: string, deliveryId: string) {
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    return {
      'content-type': 'application/json', 'user-agent': 'Tepahti-Webhooks/1', 'tepahti-event': type,
      'tepahti-delivery': deliveryId, 'tepahti-signature': `t=${t},v1=${v1}`,
    };
  }

  // ---------------------------------------------------------------- reparto de eventos

  /** Trabajo: un evento de cita → entregas de webhook y actualización de los calendarios del médico. */
  async outbound(eventId: string) {
    const ev = await this.prisma.appointmentEvent.findUnique({ where: { id: eventId } });
    if (!ev) return;
    const a = await this.prisma.appointment.findUnique({ where: { id: ev.appointmentId }, include: APPOINTMENT_API_INCLUDE });
    if (!a) return;
    const type = WEBHOOK_TYPES[ev.type];
    if (type) {
      const endpoints = await this.prisma.webhookEndpoint.findMany({ where: { clinicId: a.clinicId, active: true, events: { has: type } } });
      for (const e of endpoints) {
        const payload = { id: ev.id, type, createdAt: ev.createdAt.toISOString(), data: { appointment: apiAppointment(a) } };
        const d = await this.prisma.webhookDelivery.upsert({
          where: { endpointId_eventId: { endpointId: e.id, eventId: ev.id } }, update: {},
          create: { endpointId: e.id, eventId: ev.id, type, payload },
        });
        await this.jobs.enqueue(this.prisma, { type: WEBHOOK_JOB, payload: { deliveryId: d.id }, dedupeKey: `webhook:${d.id}` });
      }
    }
    // Aviso al médico y a recepción: cita nueva en línea o cancelada por el paciente.
    const online = ev.type === 'CREATED' && a.source === 'ONLINE';
    const patientCancel = ev.type === 'CANCELLED' && ev.actorKind === 'PATIENT';
    if ((online && a.status === 'BOOKED') || (ev.type === 'PAID' && a.source === 'ONLINE') || patientCancel) {
      const tz = (await this.prisma.clinic.findUniqueOrThrow({ where: { id: a.clinicId }, select: { timezone: true } })).timezone;
      const when = a.startsAt.toLocaleString('es-MX', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      await this.push.notify(await this.push.staffFor(a.clinicId, a.doctorId), {
        title: patientCancel ? 'Cita cancelada' : 'Nueva cita en línea',
        body: `${a.clinicPatient.name} · ${a.serviceName} · ${when} · ${a.doctor.displayName}`,
        url: '/panel', tag: `cita-${a.id}`,
      }, `cita:${ev.id}`);
    }
    const connections = await this.prisma.calendarConnection.findMany({
      where: { doctorId: a.doctorId, status: 'ACTIVE', pushAppointments: true }, select: { id: true },
    });
    for (const c of connections) {
      await this.jobs.enqueue(this.prisma, {
        type: CALENDAR_PUSH_JOB, payload: { appointmentId: a.id, connectionId: c.id }, dedupeKey: `calendar-push:${ev.id}:${c.id}`,
      });
    }
  }

  /** Trabajo: entrega un webhook. Un error lanza para reintentar con espera creciente (la cola lo limita). */
  async deliver(deliveryId: string) {
    const d = await this.prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { endpoint: true } });
    if (!d || d.status === 'DELIVERED' || !d.endpoint.active) return;
    const body = JSON.stringify(d.payload);
    let status: number | null = null;
    let error: string | null = null;
    try {
      status = (await this.transport.post({ url: d.endpoint.url, headers: this.headers(d.endpoint.secret, body, d.type, d.id), body })).status;
      if (status < 200 || status >= 300) error = `Respuesta ${status}`;
    } catch (e) {
      error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    }
    await this.prisma.webhookDelivery.update({
      where: { id: d.id },
      data: { attempts: { increment: 1 }, responseCode: status, lastError: error, ...(error ? { status: 'FAILED' } : { status: 'DELIVERED', deliveredAt: new Date() }) },
    });
    const failures = error ? d.endpoint.failureCount + 1 : 0;
    await this.prisma.webhookEndpoint.update({
      where: { id: d.endpoint.id }, data: { failureCount: failures, ...(failures >= MAX_FAILURES ? { active: false } : {}) },
    });
    if (error) throw new Error(`Webhook ${d.endpoint.url}: ${error}`);
  }
}
