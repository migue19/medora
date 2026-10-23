import {
  BadRequestException, ConflictException, Inject, Injectable, NotFoundException, OnModuleInit,
} from '@nestjs/common';
import type { Clinic, Plan, SubscriptionStatus } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { MAIL_TRANSPORT, MailTransport } from '../mail/mail.transport';
import { subscriptionInvoiceEmail } from '../mail/templates';
import { BILLING_GATEWAY, BillingGateway } from './billing.gateway';
import { CFDI_PROVIDER, CfdiProvider, CfdiRejected } from './cfdi';
import { PLANS, TRIAL_DAYS, entitlements } from './plans';

export const CFDI_JOB = 'billing.cfdi';
export const CFDI_EMAIL_JOB = 'billing.cfdi-email';

/** Regímenes fiscales del receptor (catálogo c_RegimenFiscal del SAT, los más comunes). */
export const FISCAL_REGIMES: Record<string, string> = {
  '601': 'General de Ley Personas Morales', '603': 'Personas Morales con Fines no Lucrativos',
  '605': 'Sueldos y Salarios', '606': 'Arrendamiento', '612': 'Personas Físicas con Actividades Empresariales y Profesionales',
  '616': 'Sin obligaciones fiscales', '621': 'Incorporación Fiscal', '625': 'Plataformas Tecnológicas',
  '626': 'Régimen Simplificado de Confianza',
};

const STATUS: Record<string, SubscriptionStatus | null> = {
  trialing: 'TRIALING', active: 'ACTIVE', past_due: 'PAST_DUE', unpaid: 'PAST_DUE', canceled: 'CANCELED',
  incomplete_expired: 'CANCELED', paused: 'PAST_DUE', incomplete: null,
};

@Injectable()
export class BillingService implements OnModuleInit {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(BILLING_GATEWAY) private readonly gateway: BillingGateway,
    @Inject(CFDI_PROVIDER) private readonly cfdi: CfdiProvider,
    @Inject(MAIL_TRANSPORT) private readonly mail: MailTransport,
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register(CFDI_JOB, (p) => this.issueCfdi((p as { invoiceId: string }).invoiceId));
    this.jobs.register(CFDI_EMAIL_JOB, (p) => this.emailCfdi((p as { invoiceId: string }).invoiceId));
  }

  get available() {
    return this.config.payments !== null;
  }

  /** Lo que ve la clínica en «Suscripción». */
  async status(clinicId: string, now = new Date()) {
    const clinic = await this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId }, include: { billing: true } });
    const e = entitlements(clinic, now);
    const [invoices, activeDoctors] = await Promise.all([
      this.prisma.subscriptionInvoice.findMany({ where: { clinicId }, orderBy: { paidAt: 'desc' }, take: 24 }),
      this.prisma.doctor.count({ where: { clinicId, active: true } }),
    ]);
    return {
      available: this.available, invoicingAvailable: this.config.invoicing !== null,
      plan: clinic.plan, status: clinic.subscriptionStatus, active: e.active, exempt: clinic.billingExempt,
      trialEndsAt: clinic.trialEndsAt, currentPeriodEnd: clinic.currentPeriodEnd, cancelAtPeriodEnd: clinic.cancelAtPeriodEnd,
      subscribed: clinic.stripeSubscriptionId !== null, verification: clinic.verification, verificationNote: clinic.verificationNote,
      activeDoctors,
      plans: (Object.keys(PLANS) as Plan[]).map((key) => ({ key, ...PLANS[key] })),
      billing: clinic.billing && { ...clinic.billing, updatedAt: undefined },
      regimes: FISCAL_REGIMES,
      invoices: invoices.map((i) => ({
        id: i.id, plan: i.plan, amountCents: i.amountCents, periodStart: i.periodStart, periodEnd: i.periodEnd, paidAt: i.paidAt,
        cfdiStatus: i.cfdiStatus, cfdiUuid: i.cfdiUuid, cfdiError: i.cfdiError,
        canRequest: (i.cfdiStatus === 'SKIPPED' || i.cfdiStatus === 'FAILED') && now.getTime() - i.paidAt.getTime() < 30 * 86_400_000,
      })),
    };
  }

  private async clinicFor(clinicId: string) {
    const clinic = await this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } });
    if (clinic.billingExempt) throw new ConflictException('Tu clínica tiene Medora sin costo; no necesita suscripción');
    return clinic;
  }

  /** Cambiar de plan: en prueba es inmediato; con suscripción, Stripe prorratea. Nunca por debajo de los médicos activos. */
  async changePlan(clinicId: string, plan: Plan) {
    const clinic = await this.clinicFor(clinicId);
    const doctors = await this.prisma.doctor.count({ where: { clinicId, active: true } });
    if (doctors > PLANS[plan].maxDoctors) {
      throw new ConflictException(`Tienes ${doctors} médicos activos y el plan ${PLANS[plan].name} incluye ${PLANS[plan].maxDoctors}. Desactiva médicos antes de cambiar.`);
    }
    if (clinic.stripeSubscriptionId && clinic.subscriptionStatus !== 'CANCELED') {
      await this.gateway.changePlan(clinic.stripeSubscriptionId, plan);
    }
    return this.applyPlan(clinic, plan);
  }

  /** Al bajar de plan se apagan las funciones que el nuevo plan no incluye. */
  private async applyPlan(clinic: Clinic, plan: Plan) {
    const f = PLANS[plan].features;
    return this.prisma.clinic.update({
      where: { id: clinic.id },
      data: { plan, ...(f.whatsapp ? {} : { whatsappEnabled: false }), ...(f.payments ? {} : { paymentMode: 'OFF' as const }) },
    });
  }

  /** Página de pago de Stripe para suscribirse (conserva los días de prueba que queden). */
  async checkout(clinicId: string, plan: Plan, ownerEmail: string) {
    if (!this.available) throw new ConflictException('El cobro en línea aún no está activado en Medora');
    let clinic = await this.clinicFor(clinicId);
    if (clinic.stripeSubscriptionId && clinic.subscriptionStatus !== 'CANCELED') {
      throw new ConflictException('Ya tienes una suscripción: usa «Cambiar de plan»');
    }
    if (clinic.plan !== plan) clinic = await this.changePlan(clinicId, plan);
    const customerId = clinic.stripeCustomerId ?? await this.gateway.createCustomer({ clinicId, name: clinic.name, email: ownerEmail });
    if (!clinic.stripeCustomerId) await this.prisma.clinic.update({ where: { id: clinicId }, data: { stripeCustomerId: customerId } });
    const back = `${this.config.webOrigin}/panel?tab=suscripcion`;
    return this.gateway.subscriptionCheckout({
      customerId, plan, clinicId, successUrl: `${back}&pago=listo`, cancelUrl: back,
      // Conserva los días de prueba que queden; vencida, se cobra de una vez.
      trialEnd: clinic.subscriptionStatus === 'TRIALING' && clinic.trialEndsAt && clinic.trialEndsAt > new Date() ? clinic.trialEndsAt : null,
    });
  }

  async setCancel(clinicId: string, cancel: boolean) {
    const clinic = await this.clinicFor(clinicId);
    if (!clinic.stripeSubscriptionId) throw new ConflictException('No tienes una suscripción activa');
    await this.gateway.setCancelAtPeriodEnd(clinic.stripeSubscriptionId, cancel);
    return this.prisma.clinic.update({ where: { id: clinicId }, data: { cancelAtPeriodEnd: cancel } });
  }

  async portal(clinicId: string) {
    const clinic = await this.clinicFor(clinicId);
    if (!clinic.stripeCustomerId) throw new ConflictException('Aún no tienes un método de pago registrado');
    return { url: await this.gateway.portal(clinic.stripeCustomerId, `${this.config.webOrigin}/panel?tab=suscripcion`) };
  }

  async saveBilling(clinicId: string, dto: { rfc: string; legalName: string; fiscalRegime: string; zipCode: string; cfdiUse?: string; email: string }) {
    if (!FISCAL_REGIMES[dto.fiscalRegime]) throw new BadRequestException('Régimen fiscal no válido');
    const data = {
      rfc: dto.rfc.toUpperCase().trim(), legalName: dto.legalName.toUpperCase().trim(), fiscalRegime: dto.fiscalRegime,
      zipCode: dto.zipCode, cfdiUse: dto.cfdiUse ?? 'G03', email: dto.email.toLowerCase().trim(),
    };
    return this.prisma.clinicBilling.upsert({ where: { clinicId }, update: data, create: { clinicId, ...data } });
  }

  // ---------------------------------------------------------------- Stripe

  /** Eventos de suscripción del webhook (la firma ya se verificó). El estado siempre se lee de Stripe. */
  async handleEvent(type: string, object: { id: string; mode?: string; subscription?: string | { id: string } | null; metadata?: Record<string, string> }) {
    if (type === 'checkout.session.completed') {
      const sub = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id;
      if (object.mode === 'subscription' && sub) await this.syncSubscription(sub, object.metadata?.clinicId ?? null);
      return;
    }
    if (type.startsWith('customer.subscription.')) await this.syncSubscription(object.id, object.metadata?.clinicId ?? null);
    if (type === 'invoice.paid') await this.recordInvoice(object.id);
    if (type === 'invoice.payment_failed') {
      const inv = await this.gateway.getInvoice(object.id);
      if (inv.subscriptionId) await this.syncSubscription(inv.subscriptionId, null);
    }
  }

  async syncSubscription(subscriptionId: string, clinicIdHint: string | null) {
    const s = await this.gateway.getSubscription(subscriptionId);
    // Sólo condiciones con valor: en Prisma, `{ id: undefined }` coincidiría con cualquier clínica.
    const clinicId = s.clinicId ?? clinicIdHint;
    const clinic = await this.prisma.clinic.findFirst({
      where: { OR: [{ stripeSubscriptionId: s.id }, { stripeCustomerId: s.customerId }, ...(clinicId ? [{ id: clinicId }] : [])] },
    });
    if (!clinic) return null;
    const status = STATUS[s.status];
    const updated = await this.prisma.clinic.update({
      where: { id: clinic.id },
      data: {
        stripeSubscriptionId: s.id, stripeCustomerId: s.customerId, cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        ...(status ? { subscriptionStatus: status } : {}),
        ...(s.currentPeriodEnd ? { currentPeriodEnd: s.currentPeriodEnd } : {}),
        ...(status === 'TRIALING' && s.trialEnd ? { trialEndsAt: s.trialEnd } : {}),
      },
    });
    return s.plan && s.plan !== updated.plan ? this.applyPlan(updated, s.plan) : updated;
  }

  /** Cobro aprobado: se registra (una sola vez) y se programa su CFDI. */
  async recordInvoice(stripeInvoiceId: string) {
    const inv = await this.gateway.getInvoice(stripeInvoiceId);
    if (inv.amountPaid <= 0 || !inv.paidAt) return null; // facturas de $0 (inicio de la prueba)
    const clinic = await this.prisma.clinic.findFirst({ where: { stripeCustomerId: inv.customerId } });
    if (!clinic) return null;
    if (inv.subscriptionId) await this.syncSubscription(inv.subscriptionId, clinic.id);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.subscriptionInvoice.findUnique({ where: { stripeInvoiceId } });
      if (existing) return existing;
      const row = await tx.subscriptionInvoice.create({
        data: {
          clinicId: clinic.id, stripeInvoiceId, plan: inv.plan ?? clinic.plan, amountCents: inv.amountPaid,
          periodStart: inv.periodStart, periodEnd: inv.periodEnd, paidAt: inv.paidAt!, cardFunding: inv.cardFunding,
        },
      });
      await this.jobs.enqueue(tx, { type: CFDI_JOB, payload: { invoiceId: row.id }, dedupeKey: `cfdi:${row.id}` });
      return row;
    });
  }

  // ---------------------------------------------------------------- CFDI

  /** Trabajo: timbra el CFDI del cobro. Sin datos fiscales queda «sin factura» (se puede pedir después). */
  async issueCfdi(invoiceId: string) {
    const inv = await this.prisma.subscriptionInvoice.findUnique({ where: { id: invoiceId }, include: { clinic: { include: { billing: true } } } });
    if (!inv || inv.cfdiStatus !== 'PENDING') return;
    const b = inv.clinic.billing;
    if (!b || !this.config.invoicing) {
      await this.prisma.subscriptionInvoice.update({
        where: { id: inv.id },
        data: { cfdiStatus: 'SKIPPED', cfdiError: !b ? 'Sin datos fiscales registrados' : 'La facturación no está configurada' },
      });
      return;
    }
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    try {
      const r = await this.cfdi.issue({
        paymentForm: inv.cardFunding === 'debit' ? '28' : inv.cardFunding === 'credit' ? '04' : '04',
        receiver: { rfc: b.rfc, name: b.legalName, cfdiUse: b.cfdiUse, fiscalRegime: b.fiscalRegime, zipCode: b.zipCode },
        description: `Suscripción mensual a Medora, plan ${PLANS[inv.plan].name}, del ${fmt(inv.periodStart)} al ${fmt(inv.periodEnd)}`,
        identification: `MEDORA-${inv.plan}`, totalCents: inv.amountCents,
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.subscriptionInvoice.update({ where: { id: inv.id }, data: { cfdiStatus: 'ISSUED', cfdiId: r.id, cfdiUuid: r.uuid, cfdiError: null } });
        await this.jobs.enqueue(tx, { type: CFDI_EMAIL_JOB, payload: { invoiceId: inv.id }, dedupeKey: `cfdi-email:${inv.id}` });
      });
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      if (e instanceof CfdiRejected) {
        await this.prisma.subscriptionInvoice.update({ where: { id: inv.id }, data: { cfdiStatus: 'FAILED', cfdiError: message } });
        return;
      }
      await this.prisma.subscriptionInvoice.update({ where: { id: inv.id }, data: { cfdiError: message } });
      throw e;
    }
  }

  /** Trabajo: manda el PDF y el XML al correo de facturación de la clínica. */
  async emailCfdi(invoiceId: string) {
    const inv = await this.prisma.subscriptionInvoice.findUnique({ where: { id: invoiceId }, include: { clinic: { include: { billing: true } } } });
    if (!inv?.cfdiId || !inv.clinic.billing) return;
    const [pdf, xml] = await Promise.all([this.cfdi.download(inv.cfdiId, 'pdf'), this.cfdi.download(inv.cfdiId, 'xml')]);
    const name = `medora-${inv.cfdiUuid ?? inv.cfdiId}`;
    await this.mail.send({
      to: inv.clinic.billing.email,
      ...subscriptionInvoiceEmail({
        clinicName: inv.clinic.name, planName: PLANS[inv.plan].name, amountCents: inv.amountCents, periodStart: inv.periodStart,
        periodEnd: inv.periodEnd, uuid: inv.cfdiUuid, panelLink: `${this.config.webOrigin}/panel?tab=suscripcion`,
      }),
      attachments: [
        { filename: `${name}.pdf`, contentType: 'application/pdf', content: pdf.toString('base64'), encoding: 'base64' },
        { filename: `${name}.xml`, contentType: 'application/xml', content: xml.toString('base64'), encoding: 'base64' },
      ],
      messageId: `<cfdi-${inv.id}@medora>`,
    });
  }

  /** La clínica pide la factura de un cobro que quedó sin facturar (dentro de 30 días). */
  async requestCfdi(clinicId: string, invoiceId: string, now = new Date()) {
    const inv = await this.prisma.subscriptionInvoice.findFirst({ where: { id: invoiceId, clinicId } });
    if (!inv) throw new NotFoundException('Cobro no encontrado');
    if (inv.cfdiStatus === 'ISSUED' || inv.cfdiStatus === 'PENDING') return inv;
    if (now.getTime() - inv.paidAt.getTime() >= 30 * 86_400_000) throw new ConflictException('Ese cobro tiene más de 30 días: escríbenos para facturarlo');
    if (!(await this.prisma.clinicBilling.findUnique({ where: { clinicId } }))) throw new ConflictException('Primero registra tus datos fiscales');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.subscriptionInvoice.update({ where: { id: inv.id }, data: { cfdiStatus: 'PENDING', cfdiError: null } });
      await this.jobs.enqueue(tx, { type: CFDI_JOB, payload: { invoiceId: inv.id }, dedupeKey: `cfdi:${inv.id}:${now.getTime()}` });
      return updated;
    });
  }

  async download(clinicId: string, invoiceId: string, format: 'pdf' | 'xml') {
    const inv = await this.prisma.subscriptionInvoice.findFirst({ where: { id: invoiceId, clinicId } });
    if (!inv?.cfdiId) throw new NotFoundException('Factura no encontrada');
    return { content: await this.cfdi.download(inv.cfdiId, format), filename: `medora-${inv.cfdiUuid ?? inv.cfdiId}.${format}` };
  }

  /** Fin de la prueba para una clínica nueva. */
  static trialEnd(now = new Date()) {
    return new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
  }
}
