import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import type { CalendarConnection, CalendarProvider as ProviderKind } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { JobsService } from '../jobs/jobs.service';
import type { StaffContext } from '../auth/guards';
import { CALENDAR_PROVIDERS, CalendarAuthError, CalendarProvider, CalendarProviders } from './calendar.providers';
import { CALENDAR_PUSH_JOB } from './integrations.service';

export const CALENDAR_SYNC_JOB = 'calendar.sync';
export const CALENDAR_RENEW_JOB = 'calendar.renew';
/** Se lee el calendario de ayer a 90 días adelante. */
const WINDOW_BEFORE_MS = 86_400_000;
const WINDOW_AFTER_MS = 90 * 86_400_000;
/** Respaldo por si se pierde una notificación del proveedor. */
const POLL_MS = 15 * 60_000;
const PATH: Record<ProviderKind, string> = { GOOGLE: 'google', MICROSOFT: 'microsoft' };
const KIND: Record<string, ProviderKind> = { google: 'GOOGLE', microsoft: 'MICROSOFT' };

/**
 * Calendario personal del médico (Google Calendar u Outlook): sus eventos bloquean la agenda en línea en
 * menos de un minuto (notificaciones del proveedor) y sus citas de Medora se escriben en su calendario.
 */
@Injectable()
export class CalendarService implements OnModuleInit {
  private readonly logger = new Logger('Calendario');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CALENDAR_PROVIDERS) private readonly providers: CalendarProviders,
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register(CALENDAR_SYNC_JOB, (p, now) => this.sync((p as { connectionId: string }).connectionId, now));
    this.jobs.register(CALENDAR_PUSH_JOB, (p) => this.push((p as { appointmentId: string }).appointmentId, (p as { connectionId: string }).connectionId));
    this.jobs.register(CALENDAR_RENEW_JOB, (p) => this.renew((p as { connectionId: string }).connectionId));
  }

  available(kind: ProviderKind) {
    return !!this.providers[kind] && this.config.recordsKey !== null;
  }

  private provider(kind: ProviderKind): CalendarProvider {
    const p = this.providers[kind];
    if (!p || !this.config.recordsKey) throw new ConflictException('Esa conexión de calendario aún no está activada en Medora');
    return p;
  }

  // ---------------------------------------------------------------- cifrado de tokens y estado de OAuth

  private key() {
    return Buffer.from(hkdfSync('sha256', this.config.recordsKey!, Buffer.alloc(0), 'medora-calendar-tokens', 32));
  }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key(), iv);
    const data = Buffer.concat([c.update(value, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
  }

  private decrypt(value: string) {
    const [iv, tag, data] = value.split('.').map((x) => Buffer.from(x, 'base64url'));
    const d = createDecipheriv('aes-256-gcm', this.key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  }

  /** `state` de OAuth firmado: liga la respuesta del proveedor con el médico que inició la conexión (10 min). */
  private sign(payload: object) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${createHmac('sha256', Buffer.from(this.config.jwtSecret)).update(`oauth:${body}`).digest('base64url')}`;
  }

  private verify(state: string): { m: string; d: string; c: string; p: ProviderKind; e: number } | null {
    const [body, sig] = state.split('.');
    if (!body || !sig) return null;
    const expected = createHmac('sha256', Buffer.from(this.config.jwtSecret)).update(`oauth:${body}`).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.e > Date.now() ? p : null;
  }

  private redirectUri(kind: ProviderKind) {
    return `${this.config.webOrigin}/api/integrations/${PATH[kind]}/callback`;
  }

  private notifyUrl(kind: ProviderKind) {
    return `${this.config.webOrigin}/api/integrations/${PATH[kind]}/notify`;
  }

  // ---------------------------------------------------------------- conectar y desconectar

  async status(staff: StaffContext) {
    const rows = staff.doctorId ? await this.prisma.calendarConnection.findMany({ where: { doctorId: staff.doctorId } }) : [];
    return {
      isDoctor: staff.doctorId !== null,
      providers: (['GOOGLE', 'MICROSOFT'] as ProviderKind[]).map((p) => {
        const c = rows.find((r) => r.provider === p);
        return {
          provider: p, available: this.available(p),
          connection: c && { accountEmail: c.accountEmail, status: c.status, lastSyncAt: c.lastSyncAt, lastError: c.lastError, pushAppointments: c.pushAppointments },
        };
      }),
    };
  }

  start(staff: StaffContext, kind: ProviderKind) {
    if (!staff.doctorId) throw new ForbiddenException('Sólo un usuario con perfil de médico conecta su calendario');
    const state = this.sign({ m: staff.membershipId, d: staff.doctorId, c: staff.clinicId, p: kind, e: Date.now() + 10 * 60_000 });
    return { url: this.provider(kind).authUrl(this.redirectUri(kind), state) };
  }

  /** Regreso del proveedor: guarda la conexión, abre el canal de notificaciones y sincroniza. Devuelve a dónde redirigir. */
  async callback(path: string, code: string | undefined, state: string | undefined, error: string | undefined): Promise<string> {
    const back = (q: string) => `${this.config.webOrigin}/panel?tab=account&calendario=${q}`;
    const kind = KIND[path];
    const s = state ? this.verify(state) : null;
    if (!kind || !s || s.p !== kind) return back('error');
    if (error || !code) return back('cancelado');
    try {
      const provider = this.provider(kind);
      const t = await provider.exchange(code, this.redirectUri(kind));
      const channelToken = randomBytes(24).toString('base64url');
      const conn = await this.prisma.calendarConnection.upsert({
        where: { doctorId_provider: { doctorId: s.d, provider: kind } },
        update: {
          membershipId: s.m, accountEmail: t.email, accessToken: this.encrypt(t.accessToken), refreshToken: this.encrypt(t.refreshToken),
          tokenExpiresAt: t.expiresAt, status: 'ACTIVE', lastError: null, channelToken,
        },
        create: {
          clinicId: s.c, doctorId: s.d, membershipId: s.m, provider: kind, accountEmail: t.email, accessToken: this.encrypt(t.accessToken),
          refreshToken: this.encrypt(t.refreshToken), tokenExpiresAt: t.expiresAt, channelToken,
        },
      });
      await this.openChannel(conn, t.accessToken);
      await this.sync(conn.id);
      // Citas próximas del médico: se escriben en su calendario.
      const upcoming = await this.prisma.appointment.findMany({
        where: { doctorId: s.d, status: { in: ['BOOKED'] }, startsAt: { gt: new Date(), lt: new Date(Date.now() + WINDOW_AFTER_MS) } },
        select: { id: true }, take: 500,
      });
      for (const a of upcoming) {
        await this.jobs.enqueue(this.prisma, { type: CALENDAR_PUSH_JOB, payload: { appointmentId: a.id, connectionId: conn.id }, dedupeKey: `calendar-push:conectar:${conn.id}:${a.id}:${conn.updatedAt.getTime()}` });
      }
      return back('conectado');
    } catch (e) {
      this.logger.warn(`Conexión de calendario: ${e instanceof Error ? e.message : e}`);
      return back('error');
    }
  }

  async setPush(staff: StaffContext, kind: ProviderKind, push: boolean) {
    const conn = await this.own(staff, kind);
    await this.prisma.calendarConnection.update({ where: { id: conn.id }, data: { pushAppointments: push } });
  }

  async disconnect(staff: StaffContext, kind: ProviderKind) {
    const conn = await this.own(staff, kind);
    if (conn.channelId) {
      await this.withToken(conn, (token) => this.provider(kind).stop(token, { channelId: conn.channelId!, resourceId: conn.channelResourceId, expiresAt: conn.channelExpiresAt ?? new Date() }))
        .catch(() => undefined);
    }
    await this.prisma.calendarConnection.delete({ where: { id: conn.id } });
  }

  private async own(staff: StaffContext, kind: ProviderKind) {
    if (!staff.doctorId) throw new ForbiddenException('Sólo un usuario con perfil de médico conecta su calendario');
    const conn = await this.prisma.calendarConnection.findUnique({ where: { doctorId_provider: { doctorId: staff.doctorId, provider: kind } } });
    if (!conn) throw new NotFoundException('No hay calendario conectado');
    return conn;
  }

  // ---------------------------------------------------------------- tokens y canal

  /** Ejecuta con un token vigente (lo renueva si está por vencer). Un rechazo del proveedor deja la conexión en error. */
  private async withToken<T>(conn: CalendarConnection, fn: (token: string) => Promise<T>): Promise<T> {
    const provider = this.provider(conn.provider);
    try {
      let token = this.decrypt(conn.accessToken);
      if (conn.tokenExpiresAt.getTime() - Date.now() < 120_000) {
        const t = await provider.refresh(this.decrypt(conn.refreshToken));
        token = t.accessToken;
        await this.prisma.calendarConnection.update({
          where: { id: conn.id },
          data: { accessToken: this.encrypt(t.accessToken), tokenExpiresAt: t.expiresAt, ...(t.refreshToken ? { refreshToken: this.encrypt(t.refreshToken) } : {}) },
        });
      }
      return await fn(token);
    } catch (e) {
      if (e instanceof CalendarAuthError) {
        await this.prisma.calendarConnection.update({ where: { id: conn.id }, data: { status: 'ERROR', lastError: 'El acceso al calendario se revocó o venció: vuelve a conectarlo' } });
      }
      throw e;
    }
  }

  private async openChannel(conn: CalendarConnection, token: string) {
    const w = await this.provider(conn.provider).watch(token, this.notifyUrl(conn.provider), conn.channelToken!);
    await this.prisma.calendarConnection.update({ where: { id: conn.id }, data: { channelId: w.channelId, channelResourceId: w.resourceId, channelExpiresAt: w.expiresAt } });
    await this.scheduleRenew(conn.id, w.expiresAt);
  }

  private async scheduleRenew(connectionId: string, expiresAt: Date) {
    // Un día antes (Google, 7 días) o 6 h antes (Microsoft, ~3 días).
    const margin = expiresAt.getTime() - Date.now() > 3 * 86_400_000 ? 86_400_000 : 6 * 3_600_000;
    await this.jobs.enqueue(this.prisma, {
      type: CALENDAR_RENEW_JOB, payload: { connectionId }, runAt: new Date(Math.max(Date.now(), expiresAt.getTime() - margin)),
      dedupeKey: `calendar-renew:${connectionId}:${expiresAt.getTime()}`,
    });
  }

  async renew(connectionId: string) {
    const conn = await this.prisma.calendarConnection.findUnique({ where: { id: connectionId } });
    if (!conn || conn.status !== 'ACTIVE' || !conn.channelId) return;
    const w = await this.withToken(conn, (token) => this.provider(conn.provider).renew(
      token, { channelId: conn.channelId!, resourceId: conn.channelResourceId, expiresAt: conn.channelExpiresAt ?? new Date() },
      this.notifyUrl(conn.provider), conn.channelToken!,
    ));
    await this.prisma.calendarConnection.update({ where: { id: conn.id }, data: { channelId: w.channelId, channelResourceId: w.resourceId, channelExpiresAt: w.expiresAt } });
    await this.scheduleRenew(conn.id, w.expiresAt);
  }

  // ---------------------------------------------------------------- notificaciones y sincronización

  /** Aviso del proveedor de que algo cambió: se sincroniza en segundos (avisos juntos se agrupan). */
  async notify(path: string, channelId: string | undefined, token: string | undefined, now = new Date()) {
    const kind = KIND[path];
    if (!kind || !channelId || !token) return false;
    const conn = await this.prisma.calendarConnection.findFirst({ where: { provider: kind, channelId } });
    if (!conn?.channelToken || conn.status !== 'ACTIVE') return false;
    const a = Buffer.from(conn.channelToken); const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    await this.jobs.enqueue(this.prisma, {
      type: CALENDAR_SYNC_JOB, payload: { connectionId: conn.id }, dedupeKey: `calendar-sync:${conn.id}:${Math.floor(now.getTime() / 5000)}`,
    });
    return true;
  }

  /** Trabajo: reemplaza los bloques ocupados del médico con lo que hay en su calendario y programa la siguiente revisión. */
  async sync(connectionId: string, now = new Date()) {
    const conn = await this.prisma.calendarConnection.findUnique({ where: { id: connectionId }, include: { events: { select: { externalEventId: true } } } });
    if (!conn || conn.status !== 'ACTIVE') return;
    const clinic = await this.prisma.clinic.findUniqueOrThrow({ where: { id: conn.clinicId } });
    const from = new Date(now.getTime() - WINDOW_BEFORE_MS);
    const to = new Date(now.getTime() + WINDOW_AFTER_MS);
    let blocks;
    try {
      blocks = await this.withToken(conn, (token) => this.provider(conn.provider).listBusy(token, from, to, clinic.timezone));
    } catch (e) {
      if (e instanceof CalendarAuthError) return;
      await this.prisma.calendarConnection.update({ where: { id: conn.id }, data: { lastError: (e instanceof Error ? e.message : String(e)).slice(0, 300) } });
      throw e;
    }
    const mine = new Set(conn.events.map((e) => e.externalEventId));
    const busy = blocks.filter((b) => !mine.has(b.externalId));
    await this.prisma.$transaction([
      this.prisma.externalBusy.deleteMany({ where: { connectionId: conn.id } }),
      this.prisma.externalBusy.createMany({
        data: busy.map((b) => ({ connectionId: conn.id, doctorId: conn.doctorId, externalId: b.externalId.slice(0, 1024), startsAt: b.start, endsAt: b.end })),
        skipDuplicates: true,
      }),
      this.prisma.calendarConnection.update({ where: { id: conn.id }, data: { lastSyncAt: now, lastError: null } }),
    ]);
    await this.jobs.enqueue(this.prisma, {
      type: CALENDAR_SYNC_JOB, payload: { connectionId: conn.id }, runAt: new Date(now.getTime() + POLL_MS),
      dedupeKey: `calendar-poll:${conn.id}:${Math.floor((now.getTime() + POLL_MS) / POLL_MS)}`,
    });
  }

  /** Trabajo: escribe (o borra) la cita en el calendario del médico. */
  async push(appointmentId: string, connectionId: string) {
    const conn = await this.prisma.calendarConnection.findUnique({ where: { id: connectionId } });
    if (!conn || conn.status !== 'ACTIVE' || !conn.pushAppointments) return;
    const a = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { clinic: { select: { name: true } }, location: { select: { name: true, address: true } }, clinicPatient: { select: { name: true } } },
    });
    if (!a || a.doctorId !== conn.doctorId) return;
    const link = await this.prisma.appointmentCalendarEvent.findUnique({ where: { appointmentId_connectionId: { appointmentId, connectionId } } });
    const provider = this.provider(conn.provider);
    if (a.status === 'CANCELLED' || a.status === 'PENDING_PAYMENT') {
      if (link) {
        await this.withToken(conn, (token) => provider.deleteEvent(token, link.externalEventId));
        await this.prisma.appointmentCalendarEvent.delete({ where: { appointmentId_connectionId: { appointmentId, connectionId } } });
      }
      return;
    }
    const externalId = await this.withToken(conn, (token) => provider.upsertEvent(token, link?.externalEventId ?? null, {
      appointmentId: a.id, start: a.startsAt, end: a.endsAt,
      title: `Cita: ${a.clinicPatient.name} · ${a.serviceName}${a.modality === 'VIDEO' ? ' (videoconsulta)' : ''}`,
      description: `${a.clinic.name} · ${[a.location.name, a.location.address].filter(Boolean).join(', ')}\nAgenda en Medora: ${this.config.webOrigin}/panel`,
    }));
    await this.prisma.appointmentCalendarEvent.upsert({
      where: { appointmentId_connectionId: { appointmentId, connectionId } }, update: { externalEventId: externalId },
      create: { appointmentId, connectionId, externalEventId: externalId },
    });
  }

  /** Bloques ocupados de calendarios externos para la agenda del panel. */
  async busy(clinicId: string, from: Date, to: Date, doctorId?: string) {
    const rows = await this.prisma.externalBusy.findMany({
      where: { startsAt: { lt: to }, endsAt: { gt: from }, connection: { clinicId, ...(doctorId ? { doctorId } : {}) } },
      include: { connection: { select: { provider: true } } }, orderBy: { startsAt: 'asc' }, take: 2000,
    });
    return rows.map((r) => ({ doctorId: r.doctorId, startsAt: r.startsAt, endsAt: r.endsAt, provider: r.connection.provider }));
  }

  parseKind(path: string): ProviderKind {
    const k = KIND[path];
    if (!k) throw new BadRequestException('Proveedor desconocido');
    return k;
  }
}
