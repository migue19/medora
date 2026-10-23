import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DateTime } from 'luxon';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { MAIL_TRANSPORT, MailTransport } from '../mail/mail.transport';
import { formatPrice, weeklyReportEmail } from '../mail/templates';
import { entitlements } from '../billing/plans';
import { ReportsService } from './reports.service';

export const WEEKLY_JOB = 'reports.weekly';
const ZONE = 'America/Mexico_City';

/** Resumen semanal a los propietarios, los lunes a las 8:00 (hora del centro de México). */
@Injectable()
export class WeeklyReportService implements OnModuleInit {
  private readonly logger = new Logger('ResumenSemanal');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MAIL_TRANSPORT) private readonly mail: MailTransport,
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly reports: ReportsService,
  ) {}

  async onModuleInit() {
    this.jobs.register(WEEKLY_JOB, async (_p, now) => {
      await this.sendAll(now);
      await this.scheduleNext(now);
    });
    if (this.config.jobsPollMs > 0) await this.scheduleNext(new Date()).catch((e) => this.logger.warn(String(e)));
  }

  /** Programa el siguiente lunes 8:00 (una sola vez aunque haya varias instancias). */
  async scheduleNext(now: Date) {
    let next = DateTime.fromJSDate(now, { zone: ZONE }).startOf('week').set({ hour: 8 });
    if (next.toJSDate() <= now) next = next.plus({ weeks: 1 });
    await this.jobs.enqueue(this.prisma, { type: WEEKLY_JOB, payload: {}, runAt: next.toJSDate(), dedupeKey: `reports-weekly:${next.toISODate()}` });
  }

  async sendAll(now: Date) {
    const clinics = await this.prisma.clinic.findMany({ where: { active: true, weeklyReport: true } });
    for (const c of clinics) {
      if (!entitlements(c, now).active) continue;
      try { await this.sendClinic(c.id, now); } catch (e) { this.logger.warn(`Resumen de ${c.slug}: ${e instanceof Error ? e.message : e}`); }
    }
  }

  /** Resume la semana pasada (lunes a domingo) contra la anterior. `onlyTo` lo manda a una sola persona (vista previa). */
  async sendClinic(clinicId: string, now: Date, onlyTo: string | null = null) {
    const clinic = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId }, include: { memberships: { where: { role: 'OWNER', active: true }, include: { user: true } } },
    });
    const start = DateTime.fromJSDate(now, { zone: clinic.timezone }).startOf('week').minus({ weeks: 1 });
    const iso = (d: DateTime) => d.toISODate()!;
    const [cur, prev] = await Promise.all([
      this.reports.summary(clinicId, { from: iso(start), to: iso(start.plus({ days: 6 })) }),
      this.reports.summary(clinicId, { from: iso(start.minus({ weeks: 1 })), to: iso(start.minus({ days: 1 })) }),
    ]);
    if (!onlyTo && cur.totals.appointments + cur.totals.cancelled === 0 && prev.totals.appointments === 0) return false;
    const rate = (v: number | null) => (v === null ? '—' : `${v}%`);
    const top = [...cur.doctors].filter((d) => d.occupancy !== null).sort((a, b) => (b.occupancy ?? 0) - (a.occupancy ?? 0))[0];
    const rendered = weeklyReportEmail({
      clinicName: clinic.name,
      weekLabel: `${start.setLocale('es').toFormat("d 'de' LLLL")} al ${start.plus({ days: 6 }).setLocale('es').toFormat("d 'de' LLLL")}`,
      metrics: [
        { label: 'Citas', value: String(cur.totals.appointments), previous: String(prev.totals.appointments) },
        { label: 'Atendidas', value: String(cur.totals.completed), previous: String(prev.totals.completed) },
        { label: 'Inasistencia', value: rate(cur.totals.noShowRate), previous: rate(prev.totals.noShowRate) },
        { label: 'Cancelaciones', value: String(cur.totals.cancelled), previous: String(prev.totals.cancelled) },
        { label: 'Ocupación de la agenda', value: rate(cur.totals.occupancy), previous: rate(prev.totals.occupancy) },
        { label: 'Pacientes nuevos', value: String(cur.patients.new), previous: String(prev.patients.new) },
        { label: 'Ingresos de citas atendidas', value: formatPrice(cur.revenue.completedCents), previous: formatPrice(prev.revenue.completedCents) },
      ],
      topDoctor: top ? `${top.name} (${top.occupancy}%)` : null,
      link: `${this.config.webOrigin}/panel?tab=reportes`,
    });
    const to = onlyTo ? [onlyTo] : clinic.memberships.map((m) => m.user.email);
    for (const email of to) {
      await this.mail.send({ to: email, ...rendered, messageId: `<semana-${clinic.id}-${iso(start)}-${email}@medora>` });
    }
    return true;
  }
}
