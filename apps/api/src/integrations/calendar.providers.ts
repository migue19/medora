import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type { CalendarProvider as ProviderKind } from '@prisma/client';

export interface OAuthApp { clientId: string; clientSecret: string }
export interface Tokens { accessToken: string; refreshToken: string | null; expiresAt: Date; email?: string }
/** Bloque ocupado leído del calendario (sin título: sólo horario). */
export interface BusyBlock { externalId: string; start: Date; end: Date }
export interface OutboundEvent { title: string; description: string; start: Date; end: Date; appointmentId: string }
export interface Watch { channelId: string; resourceId: string | null; expiresAt: Date }

/** Error de autorización (token revocado o vencido): hay que volver a conectar. */
export class CalendarAuthError extends Error {}

export interface CalendarProvider {
  authUrl(redirectUri: string, state: string): string;
  exchange(code: string, redirectUri: string): Promise<Tokens & { email: string; refreshToken: string }>;
  refresh(refreshToken: string): Promise<Tokens>;
  /** `allDayZone`: zona horaria para convertir los eventos de todo el día. */
  listBusy(accessToken: string, from: Date, to: Date, allDayZone: string): Promise<BusyBlock[]>;
  upsertEvent(accessToken: string, existingId: string | null, ev: OutboundEvent): Promise<string>;
  deleteEvent(accessToken: string, id: string): Promise<void>;
  watch(accessToken: string, notifyUrl: string, token: string): Promise<Watch>;
  renew(accessToken: string, current: Watch, notifyUrl: string, token: string): Promise<Watch>;
  stop(accessToken: string, current: Watch): Promise<void>;
}

export const CALENDAR_PROVIDERS = Symbol('CALENDAR_PROVIDERS');
export type CalendarProviders = Partial<Record<ProviderKind, CalendarProvider>>;

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

async function call<T>(url: string, init: RequestInit & { token?: string } = {}): Promise<{ status: number; body: T }> {
  const { token, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(rest.body && typeof rest.body === 'string' && rest.body.startsWith('{') ? { 'content-type': 'application/json' } : {}), ...(rest.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  const body = (text ? JSON.parse(text) : null) as T;
  if (res.status === 401 || (res.status === 400 && /invalid_grant/.test(text))) throw new CalendarAuthError(`Acceso rechazado (${res.status})`);
  if (res.status >= 400 && res.status !== 404 && res.status !== 410) throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  return { status: res.status, body };
}

const jwtEmail = (idToken?: string) => {
  try { return JSON.parse(Buffer.from((idToken ?? '').split('.')[1], 'base64url').toString()).email as string | undefined; } catch { return undefined; }
};

/** Fecha de un evento de todo el día (YYYY-MM-DD) a la medianoche en la zona de la clínica. */
const zonedMidnight = (date: string, zone: string) => DateTime.fromISO(date, { zone }).startOf('day').toJSDate();

// ---------------------------------------------------------------- Google Calendar

export class GoogleCalendar implements CalendarProvider {
  private readonly api = 'https://www.googleapis.com/calendar/v3';
  constructor(private readonly app: OAuthApp) {}

  authUrl(redirectUri: string, state: string) {
    return `https://accounts.google.com/o/oauth2/v2/auth?${form({
      client_id: this.app.clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent',
      scope: 'openid email https://www.googleapis.com/auth/calendar.events', state, include_granted_scopes: 'true',
    })}`;
  }

  async exchange(code: string, redirectUri: string) {
    const { body } = await call<{ access_token: string; refresh_token?: string; expires_in: number; id_token?: string }>('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ code, client_id: this.app.clientId, client_secret: this.app.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    if (!body.refresh_token) throw new Error('Google no entregó acceso permanente; vuelve a conectar y acepta los permisos');
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: new Date(Date.now() + body.expires_in * 1000), email: jwtEmail(body.id_token) ?? '' };
  }

  async refresh(refreshToken: string) {
    const { body } = await call<{ access_token: string; expires_in: number }>('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ refresh_token: refreshToken, client_id: this.app.clientId, client_secret: this.app.clientSecret, grant_type: 'refresh_token' }),
    });
    return { accessToken: body.access_token, refreshToken: null, expiresAt: new Date(Date.now() + body.expires_in * 1000) };
  }

  async listBusy(token: string, from: Date, to: Date, zone: string) {
    type Item = {
      id: string; status: string; transparency?: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string };
      attendees?: { self?: boolean; responseStatus?: string }[]; extendedProperties?: { private?: { medoraAppointmentId?: string } };
    };
    const out: BusyBlock[] = [];
    let pageToken: string | undefined;
    do {
      const q = form({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', maxResults: '2500', ...(pageToken ? { pageToken } : {}) });
      const { body } = await call<{ items: Item[]; nextPageToken?: string }>(`${this.api}/calendars/primary/events?${q}`, { token });
      for (const e of body.items ?? []) {
        if (e.status === 'cancelled' || e.transparency === 'transparent' || e.extendedProperties?.private?.medoraAppointmentId) continue;
        if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue;
        const start = e.start.dateTime ? new Date(e.start.dateTime) : zonedMidnight(e.start.date!, zone);
        const end = e.end.dateTime ? new Date(e.end.dateTime) : zonedMidnight(e.end.date!, zone);
        if (end > start) out.push({ externalId: e.id, start, end });
      }
      pageToken = body.nextPageToken;
    } while (pageToken);
    return out;
  }

  async upsertEvent(token: string, existingId: string | null, ev: OutboundEvent) {
    const body = JSON.stringify({
      summary: ev.title, description: ev.description, transparency: 'opaque',
      start: { dateTime: ev.start.toISOString() }, end: { dateTime: ev.end.toISOString() },
      extendedProperties: { private: { medoraAppointmentId: ev.appointmentId } },
    });
    if (existingId) {
      const r = await call<{ id: string }>(`${this.api}/calendars/primary/events/${encodeURIComponent(existingId)}`, { method: 'PATCH', token, body });
      if (r.status !== 404 && r.status !== 410) return r.body.id;
    }
    return (await call<{ id: string }>(`${this.api}/calendars/primary/events`, { method: 'POST', token, body })).body.id;
  }

  async deleteEvent(token: string, id: string) {
    await call(`${this.api}/calendars/primary/events/${encodeURIComponent(id)}`, { method: 'DELETE', token });
  }

  async watch(token: string, notifyUrl: string, channelToken: string) {
    const id = randomUUID();
    const { body } = await call<{ resourceId: string; expiration: string }>(`${this.api}/calendars/primary/events/watch`, {
      method: 'POST', token, body: JSON.stringify({ id, type: 'web_hook', address: notifyUrl, token: channelToken, params: { ttl: '604800' } }),
    });
    return { channelId: id, resourceId: body.resourceId, expiresAt: new Date(Number(body.expiration)) };
  }

  async renew(token: string, current: Watch, notifyUrl: string, channelToken: string) {
    const next = await this.watch(token, notifyUrl, channelToken);
    await this.stop(token, current).catch(() => undefined);
    return next;
  }

  async stop(token: string, current: Watch) {
    await call(`${this.api}/channels/stop`, { method: 'POST', token, body: JSON.stringify({ id: current.channelId, resourceId: current.resourceId }) });
  }
}

// ---------------------------------------------------------------- Outlook (Microsoft Graph)

export class MicrosoftCalendar implements CalendarProvider {
  private readonly graph = 'https://graph.microsoft.com/v1.0';
  private readonly login = 'https://login.microsoftonline.com/common/oauth2/v2.0';
  private readonly scope = 'offline_access openid email User.Read Calendars.ReadWrite';
  constructor(private readonly app: OAuthApp) {}

  authUrl(redirectUri: string, state: string) {
    return `${this.login}/authorize?${form({
      client_id: this.app.clientId, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query', scope: this.scope, state, prompt: 'select_account',
    })}`;
  }

  private async token(params: Record<string, string>) {
    const { body } = await call<{ access_token: string; refresh_token?: string; expires_in: number }>(`${this.login}/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: this.app.clientId, client_secret: this.app.clientSecret, scope: this.scope, ...params }),
    });
    return body;
  }

  async exchange(code: string, redirectUri: string) {
    const t = await this.token({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
    if (!t.refresh_token) throw new Error('Microsoft no entregó acceso permanente; vuelve a conectar');
    const me = (await call<{ mail?: string; userPrincipalName?: string }>(`${this.graph}/me`, { token: t.access_token })).body;
    return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: new Date(Date.now() + t.expires_in * 1000), email: me.mail ?? me.userPrincipalName ?? '' };
  }

  async refresh(refreshToken: string) {
    const t = await this.token({ refresh_token: refreshToken, grant_type: 'refresh_token' });
    return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt: new Date(Date.now() + t.expires_in * 1000) };
  }

  async listBusy(token: string, from: Date, to: Date) {
    type Item = { id: string; showAs: string; isCancelled: boolean; start: { dateTime: string }; end: { dateTime: string } };
    const out: BusyBlock[] = [];
    let url: string | undefined = `${this.graph}/me/calendarView?${form({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), $select: 'id,showAs,isCancelled,start,end', $top: '500' })}`;
    while (url) {
      const r: { body: { value: Item[]; '@odata.nextLink'?: string } } = await call(url, { token, headers: { Prefer: 'outlook.timezone="UTC"' } });
      for (const e of r.body.value ?? []) {
        if (e.isCancelled || e.showAs === 'free' || e.showAs === 'workingElsewhere') continue;
        const start = new Date(`${e.start.dateTime.slice(0, 19)}Z`);
        const end = new Date(`${e.end.dateTime.slice(0, 19)}Z`);
        if (end > start) out.push({ externalId: e.id, start, end });
      }
      url = r.body['@odata.nextLink'];
    }
    return out;
  }

  async upsertEvent(token: string, existingId: string | null, ev: OutboundEvent) {
    const body = JSON.stringify({
      subject: ev.title, body: { contentType: 'text', content: ev.description }, showAs: 'busy',
      start: { dateTime: ev.start.toISOString().slice(0, 19), timeZone: 'UTC' }, end: { dateTime: ev.end.toISOString().slice(0, 19), timeZone: 'UTC' },
    });
    if (existingId) {
      const r = await call<{ id: string }>(`${this.graph}/me/events/${encodeURIComponent(existingId)}`, { method: 'PATCH', token, body });
      if (r.status !== 404) return r.body.id;
    }
    return (await call<{ id: string }>(`${this.graph}/me/events`, { method: 'POST', token, body })).body.id;
  }

  async deleteEvent(token: string, id: string) {
    await call(`${this.graph}/me/events/${encodeURIComponent(id)}`, { method: 'DELETE', token });
  }

  async watch(token: string, notifyUrl: string, clientState: string) {
    const expires = new Date(Date.now() + 4200 * 60_000); // máximo de Graph para eventos: 4230 min
    const { body } = await call<{ id: string; expirationDateTime: string }>(`${this.graph}/subscriptions`, {
      method: 'POST', token,
      body: JSON.stringify({ changeType: 'created,updated,deleted', notificationUrl: notifyUrl, resource: 'me/events', expirationDateTime: expires.toISOString(), clientState }),
    });
    return { channelId: body.id, resourceId: null, expiresAt: new Date(body.expirationDateTime) };
  }

  async renew(token: string, current: Watch, notifyUrl: string, clientState: string) {
    const expires = new Date(Date.now() + 4200 * 60_000);
    const r = await call<{ expirationDateTime: string }>(`${this.graph}/subscriptions/${current.channelId}`, {
      method: 'PATCH', token, body: JSON.stringify({ expirationDateTime: expires.toISOString() }),
    });
    return r.status === 404 ? this.watch(token, notifyUrl, clientState) : { ...current, expiresAt: new Date(r.body.expirationDateTime) };
  }

  async stop(token: string, current: Watch) {
    await call(`${this.graph}/subscriptions/${current.channelId}`, { method: 'DELETE', token });
  }
}

// ---------------------------------------------------------------- simulado (pruebas)

export class MemoryCalendar implements CalendarProvider {
  events = new Map<string, { id: string; start: Date; end: Date; free?: boolean; declined?: boolean; medora?: string; title?: string }>();
  watches: { channelId: string; token: string; notifyUrl: string }[] = [];
  revoked = false;
  private seq = 0;

  authUrl(redirectUri: string, state: string) { return `https://cuentas.test/autorizar?redirect=${encodeURIComponent(redirectUri)}&state=${state}`; }
  async exchange(code: string) {
    if (code !== 'codigo-valido') throw new Error('Código inválido');
    return { accessToken: 'acceso-1', refreshToken: 'renovacion-1', expiresAt: new Date(Date.now() + 3600_000), email: 'dra.ana@gmail.test' };
  }
  async refresh() {
    if (this.revoked) throw new CalendarAuthError('revocado');
    return { accessToken: 'acceso-2', refreshToken: null, expiresAt: new Date(Date.now() + 3600_000) };
  }
  async listBusy(_t: string, from: Date, to: Date) {
    if (this.revoked) throw new CalendarAuthError('revocado');
    return [...this.events.values()].filter((e) => !e.free && !e.declined && !e.medora && e.end > from && e.start < to)
      .map((e) => ({ externalId: e.id, start: e.start, end: e.end }));
  }
  async upsertEvent(_t: string, existingId: string | null, ev: OutboundEvent) {
    const id = existingId && this.events.has(existingId) ? existingId : `ev-${++this.seq}`;
    this.events.set(id, { id, start: ev.start, end: ev.end, medora: ev.appointmentId, title: ev.title });
    return id;
  }
  async deleteEvent(_t: string, id: string) { this.events.delete(id); }
  async watch(_t: string, notifyUrl: string, token: string) {
    const w = { channelId: `canal-${++this.seq}`, token, notifyUrl };
    this.watches.push(w);
    return { channelId: w.channelId, resourceId: 'recurso', expiresAt: new Date(Date.now() + 7 * 86_400_000) };
  }
  async renew(t: string, _c: Watch, notifyUrl: string, token: string) { return this.watch(t, notifyUrl, token); }
  async stop() { /* nada */ }
  /** Evento personal del médico. */
  add(id: string, start: Date, end: Date, extra: { free?: boolean; declined?: boolean } = {}) { this.events.set(id, { id, start, end, ...extra }); }
}

