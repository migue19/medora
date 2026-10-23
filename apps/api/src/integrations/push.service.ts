import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import webpush from 'web-push';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { JobsService } from '../jobs/jobs.service';

export interface PushMessage { title: string; body: string; url: string; tag?: string }
export interface PushTarget { endpoint: string; p256dh: string; auth: string }

export interface PushTransport {
  /** Devuelve false si la suscripción ya no existe (el navegador la dio de baja). */
  send(target: PushTarget, message: PushMessage): Promise<boolean>;
}
export const PUSH_TRANSPORT = Symbol('PUSH_TRANSPORT');
export const PUSH_JOB = 'push.send';

export class WebPushTransport implements PushTransport {
  constructor(private readonly cfg: NonNullable<AppConfig['push']>) {}
  async send(t: PushTarget, m: PushMessage) {
    try {
      await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(m), {
        vapidDetails: { subject: this.cfg.subject, publicKey: this.cfg.publicKey, privateKey: this.cfg.privateKey }, TTL: 3600, urgency: 'high',
      });
      return true;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return false;
      throw e;
    }
  }
}

export class MemoryPush implements PushTransport {
  sent: { endpoint: string; message: PushMessage }[] = [];
  gone = new Set<string>();
  async send(t: PushTarget, message: PushMessage) {
    if (this.gone.has(t.endpoint)) return false;
    this.sent.push({ endpoint: t.endpoint, message });
    return true;
  }
}

/** Notificaciones push al personal en sus dispositivos (PWA). */
@Injectable()
export class PushService implements OnModuleInit {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PUSH_TRANSPORT) private readonly transport: PushTransport | null,
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register(PUSH_JOB, (p) => this.deliver(p as unknown as { membershipIds: string[]; message: PushMessage }));
  }

  get publicKey() {
    return this.config.push?.publicKey ?? null;
  }

  async subscribe(userId: string, membershipId: string, sub: PushTarget) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint }, update: { userId, membershipId, p256dh: sub.p256dh, auth: sub.auth },
      create: { userId, membershipId, ...sub },
    });
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
  }

  /** Encola un aviso para estas membresías (sólo si hay push configurado y alguien suscrito). */
  async notify(membershipIds: string[], message: PushMessage, dedupeKey: string) {
    const ids = [...new Set(membershipIds)];
    if (!this.transport || !ids.length) return;
    if (!(await this.prisma.pushSubscription.count({ where: { membershipId: { in: ids } } }))) return;
    await this.jobs.enqueue(this.prisma, { type: PUSH_JOB, payload: { membershipIds: ids, message } as never, dedupeKey: `push:${dedupeKey}` });
  }

  async deliver(p: { membershipIds: string[]; message: PushMessage }) {
    if (!this.transport) return;
    const subs = await this.prisma.pushSubscription.findMany({ where: { membershipId: { in: p.membershipIds } } });
    for (const s of subs) {
      const alive = await this.transport.send(s, p.message).catch(() => true);
      if (!alive) await this.prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
    }
  }

  /** A quién avisar de una cita: el médico (si tiene usuario) y recepción. */
  async staffFor(clinicId: string, doctorId: string) {
    const [doctor, reception] = await Promise.all([
      this.prisma.doctor.findUnique({ where: { id: doctorId }, select: { membershipId: true } }),
      this.prisma.membership.findMany({ where: { clinicId, role: 'RECEPTION', active: true }, select: { id: true } }),
    ]);
    return [...(doctor?.membershipId ? [doctor.membershipId] : []), ...reception.map((m) => m.id)];
  }
}
