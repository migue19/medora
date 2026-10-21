import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { DateTime } from 'luxon';
import { createApp } from '../../src/bootstrap';
import { hashPassword } from '../../src/common/crypto';
import { JobsService } from '../../src/jobs/jobs.service';
import { MemoryTransport, OutgoingEmail } from '../../src/mail/mail.transport';
import { MemoryWhatsApp } from '../../src/notifications/whatsapp.transport';

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
  mail: MemoryTransport;
  whatsapp: MemoryWhatsApp;
  jobs: JobsService;
  /** Ejecuta la cola y devuelve los correos enviados en esta corrida. */
  deliver(): Promise<OutgoingEmail[]>;
  close(): Promise<void>;
}

let sharedPrisma: PrismaClient | null = null;

export async function startHarness(): Promise<Harness> {
  const databaseUrl = testDatabaseUrl();
  const mail = new MemoryTransport();
  const whatsapp = new MemoryWhatsApp();
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
    mail: { from: 'Medora <no-reply@test.mx>', smtp: null },
    whatsapp: {
      token: 'prueba', phoneNumberId: '123', template: 'recordatorio_cita', reviewTemplate: 'invitacion_opinion',
      language: 'es_MX', apiVersion: 'v21.0',
      defaultCountryCode: '52',
    },
    jobsPollMs: 0,
  }, false, { mail, whatsapp });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  sharedPrisma = prisma;
  const jobs = app.get(JobsService);
  return {
    app, base: `http://127.0.0.1:${port}`, prisma, mail, whatsapp, jobs,
    async deliver() {
      const before = mail.sent.length;
      await jobs.runOnce();
      return mail.sent.slice(before);
    },
    async close() { sharedPrisma = null; await prisma.$disconnect(); await app.close(); },
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
  await prisma.$executeRawUnsafe(`TRUNCATE "ReviewEvent", "Review", "ReviewInvitation", "WaitlistOffer", "WaitlistEntry", "PatientLinkRequest", "PatientAudit", "PatientNote", "NotificationLog", "AppointmentActionToken", "Job", "AuthToken", "StaffInvitation", "AppointmentEvent", "Appointment", "TimeOff", "ScheduleRule",
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

/** Token que viaja en el fragmento (#) del primer enlace del correo. */
export function linkToken(email: OutgoingEmail): string {
  const m = email.text.match(/https?:\/\/\S+#([A-Za-z0-9_-]{20,})/);
  if (!m) throw new Error(`Sin enlace con token en «${email.subject}»`);
  return m[1];
}

/** Invita a un integrante, entrega el correo y acepta la invitación con la contraseña indicada. */
export async function addStaff(
  h: Harness, inviter: Client, data: { name: string; email: string; role: string; password: string },
): Promise<{ membershipId: string }> {
  const inv = await inviter.post('/api/clinic/invitations', { name: data.name, email: data.email, role: data.role });
  if (inv.status !== 201) throw new Error(`invitación ${inv.status} ${JSON.stringify(inv.body)}`);
  const sent = (await h.deliver()).filter((e) => e.to === data.email.toLowerCase());
  const token = linkToken(sent[sent.length - 1]);
  const accepted = await new Client(h.base).post('/api/auth/invitations/accept', { token, password: data.password });
  if (accepted.status !== 200) throw new Error(`aceptar ${accepted.status} ${JSON.stringify(accepted.body)}`);
  const invitation = await h.prisma.staffInvitation.findUniqueOrThrow({ where: { id: inv.body.id } });
  return { membershipId: invitation.membershipId! };
}

/** Registra un paciente. Por defecto marca su correo como confirmado (requisito para reservar). */
export async function registerPatient(base: string, name: string, opts: { verified?: boolean } = {}): Promise<Client> {
  const c = new Client(base);
  const r = await c.post('/api/patient/auth/register', {
    name, email: `${name.toLowerCase().replace(/\W+/g, '.')}-${randomUUID().slice(0, 8)}@test.mx`,
    phone: '55 1234 5678', password: 'paciente-seguro-1',
  });
  if (r.status !== 201) throw new Error(`register ${r.status} ${JSON.stringify(r.body)}`);
  c.token = r.body.accessToken;
  if (opts.verified ?? true) {
    if (!sharedPrisma) throw new Error('Inicia el harness antes de registrar pacientes');
    await sharedPrisma.patientAccount.update({ where: { id: r.body.patient.id }, data: { emailVerifiedAt: new Date() } });
    // El JWT no cambia: la verificación se lee de la base en cada petición.
  }
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
