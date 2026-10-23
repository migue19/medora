import Stripe from 'stripe';
import type { Plan } from '@prisma/client';
import { PaymentsConfig } from '../config';
import { PLANS } from './plans';

export interface SubscriptionState {
  id: string;
  customerId: string;
  /** Estado de Stripe: trialing, active, past_due, canceled, unpaid, incomplete… */
  status: string;
  plan: Plan | null;
  currentPeriodEnd: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  clinicId: string | null;
}

export interface InvoiceState {
  id: string;
  subscriptionId: string | null;
  customerId: string;
  status: string;
  amountPaid: number;
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date | null;
  /** credit, debit, prepaid o null (otro medio). */
  cardFunding: string | null;
  plan: Plan | null;
}

export interface BillingGateway {
  createCustomer(p: { clinicId: string; name: string; email: string }): Promise<string>;
  subscriptionCheckout(p: { customerId: string; plan: Plan; trialEnd: Date | null; clinicId: string; successUrl: string; cancelUrl: string }): Promise<{ url: string }>;
  getSubscription(id: string): Promise<SubscriptionState>;
  changePlan(subscriptionId: string, plan: Plan): Promise<void>;
  setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<void>;
  /** Portal de Stripe para cambiar la tarjeta. */
  portal(customerId: string, returnUrl: string): Promise<string>;
  getInvoice(id: string): Promise<InvoiceState>;
}

export const BILLING_GATEWAY = Symbol('BILLING_GATEWAY');

const lookupKey = (plan: Plan) => `medora_${plan.toLowerCase()}_mxn_v1`;
const planFromKey = (key: string | null | undefined): Plan | null =>
  (Object.keys(PLANS) as Plan[]).find((p) => lookupKey(p) === key) ?? null;
const date = (unix: number | null | undefined) => (unix ? new Date(unix * 1000) : null);

/** Suscripciones con Stripe Billing (cuenta de Medora). Los precios se crean solos por su lookup_key. */
export class StripeBilling implements BillingGateway {
  private readonly stripe: Stripe;
  private prices = new Map<Plan, string>();

  constructor(config: PaymentsConfig) {
    this.stripe = new Stripe(config.secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
  }

  private async price(plan: Plan): Promise<string> {
    const cached = this.prices.get(plan);
    if (cached) return cached;
    const key = lookupKey(plan);
    const found = await this.stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 });
    let id = found.data[0]?.id;
    if (!id) {
      const product = await this.stripe.products.create(
        { name: `Medora · Plan ${PLANS[plan].name}`, metadata: { plan } }, { idempotencyKey: `producto-${key}` },
      );
      id = (await this.stripe.prices.create({
        product: product.id, currency: 'mxn', unit_amount: PLANS[plan].priceCents, recurring: { interval: 'month' },
        lookup_key: key, tax_behavior: 'inclusive', metadata: { plan },
      }, { idempotencyKey: `precio-${key}` })).id;
    }
    this.prices.set(plan, id);
    return id;
  }

  async createCustomer(p: { clinicId: string; name: string; email: string }) {
    const c = await this.stripe.customers.create(
      { name: p.name, email: p.email, metadata: { clinicId: p.clinicId } }, { idempotencyKey: `cliente-${p.clinicId}` },
    );
    return c.id;
  }

  async subscriptionCheckout(p: { customerId: string; plan: Plan; trialEnd: Date | null; clinicId: string; successUrl: string; cancelUrl: string }) {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription', locale: 'es', customer: p.customerId,
      line_items: [{ price: await this.price(p.plan), quantity: 1 }],
      // Stripe exige que el fin de la prueba esté al menos 48 h adelante; si falta menos, cobra de una vez.
      subscription_data: {
        metadata: { clinicId: p.clinicId },
        ...(p.trialEnd && p.trialEnd.getTime() - Date.now() > 49 * 3_600_000 ? { trial_end: Math.floor(p.trialEnd.getTime() / 1000) } : {}),
      },
      metadata: { clinicId: p.clinicId, kind: 'subscription' },
      success_url: p.successUrl, cancel_url: p.cancelUrl,
    });
    if (!session.url) throw new Error('Stripe no devolvió la página de pago');
    return { url: session.url };
  }

  async getSubscription(id: string): Promise<SubscriptionState> {
    const s = await this.stripe.subscriptions.retrieve(id);
    const item = s.items.data[0];
    return {
      id: s.id, customerId: typeof s.customer === 'string' ? s.customer : s.customer.id, status: s.status,
      plan: planFromKey(item?.price.lookup_key), currentPeriodEnd: date(item?.current_period_end), trialEnd: date(s.trial_end),
      cancelAtPeriodEnd: s.cancel_at_period_end, clinicId: s.metadata?.clinicId ?? null,
    };
  }

  async changePlan(subscriptionId: string, plan: Plan) {
    const s = await this.stripe.subscriptions.retrieve(subscriptionId);
    await this.stripe.subscriptions.update(subscriptionId, {
      items: [{ id: s.items.data[0].id, price: await this.price(plan) }], proration_behavior: 'create_prorations',
    });
  }

  async setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean) {
    await this.stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: cancel });
  }

  async portal(customerId: string, returnUrl: string) {
    return (await this.stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl, locale: 'es' })).url;
  }

  async getInvoice(id: string): Promise<InvoiceState> {
    const inv = await this.stripe.invoices.retrieve(id);
    const sub = inv.parent?.subscription_details?.subscription ?? null;
    const line = inv.lines.data[0];
    let cardFunding: string | null = null;
    // El medio de pago está en los pagos de la factura (API 2025+).
    const payments = await this.stripe.invoicePayments.list({ invoice: id, limit: 1 }).catch(() => null);
    const pi = payments?.data[0]?.payment.payment_intent;
    if (pi) {
      const intent = await this.stripe.paymentIntents.retrieve(typeof pi === 'string' ? pi : pi.id, { expand: ['latest_charge'] });
      const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
      cardFunding = charge?.payment_method_details?.card?.funding ?? null;
    }
    const priceRef = line?.pricing?.price_details?.price;
    const price = priceRef ? (typeof priceRef === 'string' ? await this.stripe.prices.retrieve(priceRef) : priceRef) : null;
    return {
      id: inv.id!, subscriptionId: typeof sub === 'string' ? sub : sub?.id ?? null,
      customerId: typeof inv.customer === 'string' ? inv.customer : inv.customer!.id, status: inv.status ?? 'draft',
      amountPaid: inv.amount_paid, periodStart: date(line?.period.start)!, periodEnd: date(line?.period.end)!,
      paidAt: date(inv.status_transitions?.paid_at), cardFunding, plan: planFromKey(price?.lookup_key),
    };
  }
}

/** Proveedor simulado para pruebas. */
export class MemoryBilling implements BillingGateway {
  customers: { id: string; clinicId: string; email: string }[] = [];
  subscriptions = new Map<string, SubscriptionState>();
  invoices = new Map<string, InvoiceState>();
  checkouts: { customerId: string; plan: Plan; trialEnd: Date | null; clinicId: string }[] = [];

  async createCustomer(p: { clinicId: string; name: string; email: string }) {
    const id = `cus_${this.customers.length + 1}`;
    this.customers.push({ id, clinicId: p.clinicId, email: p.email });
    return id;
  }
  async subscriptionCheckout(p: { customerId: string; plan: Plan; trialEnd: Date | null; clinicId: string }) {
    this.checkouts.push({ customerId: p.customerId, plan: p.plan, trialEnd: p.trialEnd, clinicId: p.clinicId });
    return { url: `https://pago.test/suscripcion/${this.checkouts.length}` };
  }
  async getSubscription(id: string) {
    const s = this.subscriptions.get(id);
    if (!s) throw new Error(`Suscripción desconocida ${id}`);
    return s;
  }
  async changePlan(subscriptionId: string, plan: Plan) { this.subscriptions.get(subscriptionId)!.plan = plan; }
  async setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean) { this.subscriptions.get(subscriptionId)!.cancelAtPeriodEnd = cancel; }
  async portal() { return 'https://pago.test/portal'; }
  async getInvoice(id: string) {
    const i = this.invoices.get(id);
    if (!i) throw new Error(`Factura desconocida ${id}`);
    return i;
  }
}

export class DisabledBilling implements BillingGateway {
  private fail(): never { throw new Error('El cobro de suscripciones no está configurado'); }
  createCustomer(): Promise<string> { this.fail(); }
  subscriptionCheckout(): Promise<{ url: string }> { this.fail(); }
  getSubscription(): Promise<SubscriptionState> { this.fail(); }
  changePlan(): Promise<void> { this.fail(); }
  setCancelAtPeriodEnd(): Promise<void> { this.fail(); }
  portal(): Promise<string> { this.fail(); }
  getInvoice(): Promise<InvoiceState> { this.fail(); }
}

export function createBilling(config: PaymentsConfig | null): BillingGateway {
  return config ? new StripeBilling(config) : new DisabledBilling();
}
