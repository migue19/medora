import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { DateTime } from 'luxon';
import { createApp } from '../../src/bootstrap';
import { hashPassword } from '../../src/common/crypto';

export const ORIGIN = 'http://localhost:6011';
export const TZ = 'America/Mexico_City';

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Define TEST_DATABASE_URL');
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) throw new Error('TEST_DATABASE_URL debe apuntar a una base que termine en _test');
  return url;
}

export interface Harness {
  app: INestApplication;
  base: string;
  prisma: PrismaClient;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const databaseUrl = testDatabaseUrl();
  const app = await createApp({
    databaseUrl,
    jwtSecret: new TextEncoder().encode('integration-secret-integration-secret-0123'),
    webOrigin: ORIGIN,
    cookieSecure: false,
    port: 0,
    host: '127.0.0.1',
    production: false,
    trustProxy: false,
    rateLimitEnabled: false,
  }, false);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  return {
    app, base: `http://127.0.0.1:${port}`, prisma,
    async close() { await prisma.$disconnect(); await app.close(); },
  };
}

export interface Res<T = any> { status: number; body: T; cookie: string | null }

export class Client {
  cookies = new Map<string, string>();
  token: string | null = null;
  constructor(private readonly base: string) {}

  async req<T = any>(method: string, path: string, body?: unknown, opts: { origin?: string | null } = {}): Promise<Res<T>> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    const origin = opts.origin === undefined ? ORIGIN : opts.origin;
    if (origin) headers.origin = origin;
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.getSetCookie();
    for (const c of setCookie) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      if (value) this.cookies.set(name, value); else this.cookies.delete(name);
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, cookie: setCookie[0] ?? null };
  }

  get = <T = any>(p: string) => this.req<T>('GET', p);
  post = <T = any>(p: string, b?: unknown) => this.req<T>('POST', p, b ?? {});
  patch = <T = any>(p: string, b: unknown) => this.req<T>('PATCH', p, b);
  put = <T = any>(p: string, b: unknown) => this.req<T>('PUT', p, b);
  del = <T = any>(p: string) => this.req<T>('DELETE', p);
}

export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE "AppointmentEvent", "Appointment", "TimeOff", "ScheduleRule",
    "DoctorService", "Service", "Doctor", "ClinicPatient", "RefreshSession", "PatientAccount", "Membership",
    "User", "Clinic" CASCADE`);
}

export async function createClinicWithOwner(prisma: PrismaClient, slug: string) {
  const clinic = await prisma.clinic.create({ data: { slug, name: `Clínica ${slug}` } });
  const email = `owner-${slug}@test.mx`;
  const password = 'propietario-seguro-1';
  const user = await prisma.user.create({ data: { email, name: `Dueño ${slug}`, passwordHash: await hashPassword(password) } });
  await prisma.membership.create({ data: { userId: user.id, clinicId: clinic.id, role: 'OWNER' } });
  return { clinic, email, password };
}

export async function loginStaff(base: string, email: string, password: string, clinicSlug: string): Promise<Client> {
  const c = new Client(base);
  const r = await c.post('/api/auth/login', { email, password, clinicSlug });
  if (r.status !== 200) throw new Error(`login ${r.status} ${JSON.stringify(r.body)}`);
  c.token = r.body.accessToken;
  return c;
}

export async function registerPatient(base: string, name: string): Promise<Client> {
  const c = new Client(base);
  const r = await c.post('/api/patient/auth/register', {
    name, email: `${name.toLowerCase().replace(/\W+/g, '.')}-${randomUUID().slice(0, 8)}@test.mx`,
    phone: '55 1234 5678', password: 'paciente-seguro-1',
  });
  if (r.status !== 201) throw new Error(`register ${r.status} ${JSON.stringify(r.body)}`);
  c.token = r.body.accessToken;
  return c;
}

/** Próximo lunes a por lo menos 7 días de hoy (fecha local). */
export function nextMonday(): string {
  let d = DateTime.now().setZone(TZ).plus({ days: 7 }).startOf('day');
  while (d.weekday !== 1) d = d.plus({ days: 1 });
  return d.toISODate()!;
}

export function localIso(date: string, time: string): string {
  return DateTime.fromISO(`${date}T${time}`, { zone: TZ }).toUTC().toISO()!;
}

export { randomUUID };
