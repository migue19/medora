import Stripe from 'stripe';
import { PaymentsConfig } from '../config';

export type PayMethod = 'card' | 'oxxo' | 'spei';

export interface CheckoutRequest {
  amountCents: number;
  description: string;
  customerEmail: string;
  customerName: string;
  methods: PayMethod[];
  expiresAt: Date;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface CheckoutSession { id: string; url: string; expiresAt: Date }

/** Estado normalizado de una sesión de pago, leído siempre del proveedor (nunca del cuerpo de un webhook). */
export interface CheckoutState {
  id: string;
  /** open: sin terminar · voucher: ficha OXXO o SPEI emitida · paid · failed · expired */
  state: 'open' | 'voucher' | 'paid' | 'failed' | 'expired';
  paymentIntentId: string | null;
  method: string | null;
  amountCents: number | null;
}

export class RefundError extends Error {
  /** El proveedor no puede reembolsar (p. ej. pago en OXXO): requiere atención manual, no reintentos. */
  constructor(message: string, readonly permanent: boolean) { super(message); }
}

export interface PaymentGateway {
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  getCheckout(id: string): Promise<CheckoutState>;
  expireCheckout(id: string): Promise<void>;
  refund(paymentIntentId: string, amountCents: number, idempotencyKey: string): Promise<{ id: string }>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/** Stripe Checkout (cuenta de Medora), en pesos mexicanos. */
export class StripeGateway implements PaymentGateway {
  private readonly stripe: Stripe;

  constructor(config: PaymentsConfig) {
    this.stripe = new Stripe(config.secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const types: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] = ['card'];
    if (req.methods.includes('oxxo')) types.push('oxxo');
    const spei = req.methods.includes('spei');
    if (spei) types.push('customer_balance');
    // La transferencia SPEI de Stripe requiere un cliente para asignarle su CLABE.
    const customer = spei
      ? (await this.stripe.customers.create({ email: req.customerEmail, name: req.customerName }, { idempotencyKey: `${req.idempotencyKey}:cliente` })).id
      : undefined;
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      locale: 'es',
      payment_method_types: types,
      line_items: [{ quantity: 1, price_data: { currency: 'mxn', unit_amount: req.amountCents, product_data: { name: req.description } } }],
      ...(customer ? { customer } : { customer_email: req.customerEmail }),
      expires_at: Math.floor(req.expiresAt.getTime() / 1000),
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
      metadata: req.metadata,
      payment_intent_data: { metadata: req.metadata, description: req.description },
      payment_method_options: {
        ...(req.methods.includes('oxxo') ? { oxxo: { expires_after_days: 1 } } : {}),
        ...(spei ? { customer_balance: { funding_type: 'bank_transfer', bank_transfer: { type: 'mx_bank_transfer' } } } : {}),
      },
    }, { idempotencyKey: req.idempotencyKey });
    if (!session.url) throw new Error('Stripe no devolvió la página de pago');
    return { id: session.id, url: session.url, expiresAt: new Date(session.expires_at * 1000) };
  }

  async getCheckout(id: string): Promise<CheckoutState> {
    const s = await this.stripe.checkout.sessions.retrieve(id, { expand: ['payment_intent.latest_charge'] });
    const intent = typeof s.payment_intent === 'object' ? s.payment_intent : null;
    const charge = intent && typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
    const method = charge?.payment_method_details?.type ?? intent?.payment_method_types?.[0] ?? null;
    let state: CheckoutState['state'];
    if (s.payment_status === 'paid') state = 'paid';
    else if (s.status === 'expired') state = 'expired';
    else if (s.status === 'open') state = 'open';
    else if (intent && (intent.status === 'canceled' || intent.status === 'requires_payment_method')) state = 'failed';
    else state = 'voucher';
    return { id: s.id, state, paymentIntentId: intent?.id ?? (typeof s.payment_intent === 'string' ? s.payment_intent : null), method, amountCents: s.amount_total };
  }

  async expireCheckout(id: string): Promise<void> {
    const s = await this.stripe.checkout.sessions.retrieve(id);
    if (s.status === 'open') await this.stripe.checkout.sessions.expire(id);
  }

  async refund(paymentIntentId: string, amountCents: number, idempotencyKey: string) {
    try {
      const r = await this.stripe.refunds.create(
        { payment_intent: paymentIntentId, amount: amountCents, reason: 'requested_by_customer' }, { idempotencyKey },
      );
      return { id: r.id };
    } catch (e) {
      // Errores de la petición (p. ej. método sin reembolsos) no se arreglan reintentando.
      const permanent = e instanceof Stripe.errors.StripeInvalidRequestError;
      throw new RefundError(e instanceof Error ? e.message : String(e), permanent);
    }
  }
}

/** Sin llaves de Stripe: los pagos en línea no están disponibles. */
export class DisabledGateway implements PaymentGateway {
  private fail(): never { throw new Error('Los pagos en línea no están configurados'); }
  createCheckout(): Promise<CheckoutSession> { this.fail(); }
  getCheckout(): Promise<CheckoutState> { this.fail(); }
  expireCheckout(): Promise<void> { this.fail(); }
  refund(): Promise<{ id: string }> { this.fail(); }
}

/** Proveedor simulado para pruebas: el test decide qué pasa con cada sesión. */
export class MemoryGateway implements PaymentGateway {
  sessions = new Map<string, CheckoutState & { request: CheckoutRequest; expiresAt: Date }>();
  refunds: { paymentIntentId: string; amountCents: number; idempotencyKey: string }[] = [];
  /** Hace fallar los reembolsos (true = permanente, false = temporal). */
  refundFailure: boolean | null = null;
  private seq = 0;

  async createCheckout(req: CheckoutRequest): Promise<CheckoutSession> {
    const existing = [...this.sessions.values()].find((s) => s.request.idempotencyKey === req.idempotencyKey);
    if (existing) return { id: existing.id, url: `https://pago.test/${existing.id}`, expiresAt: existing.expiresAt };
    const id = `cs_test_${++this.seq}`;
    this.sessions.set(id, { id, state: 'open', paymentIntentId: null, method: null, amountCents: req.amountCents, request: req, expiresAt: req.expiresAt });
    return { id, url: `https://pago.test/${id}`, expiresAt: req.expiresAt };
  }

  async getCheckout(id: string): Promise<CheckoutState> {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`Sesión desconocida ${id}`);
    const { request: _r, expiresAt: _e, ...state } = s;
    return state;
  }

  async expireCheckout(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (s?.state === 'open') s.state = 'expired';
  }

  async refund(paymentIntentId: string, amountCents: number, idempotencyKey: string) {
    if (this.refundFailure !== null) throw new RefundError('Reembolso rechazado (simulado)', this.refundFailure);
    if (!this.refunds.some((r) => r.idempotencyKey === idempotencyKey)) this.refunds.push({ paymentIntentId, amountCents, idempotencyKey });
    return { id: `re_${idempotencyKey}` };
  }

  /** Simula lo que hace el paciente en la página de Stripe. */
  set(id: string, state: CheckoutState['state'], method = 'card') {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`Sesión desconocida ${id}`);
    s.state = state;
    if (state !== 'open' && state !== 'expired') { s.method = method; s.paymentIntentId ??= `pi_${id}`; }
  }
}

export function createGateway(config: PaymentsConfig | null): PaymentGateway {
  return config ? new StripeGateway(config) : new DisabledGateway();
}

/** Verifica la firma del webhook con el secreto de Stripe y devuelve el evento. */
export function verifyWebhook(rawBody: Buffer, signature: string, config: PaymentsConfig): Stripe.Event {
  return Stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret);
}
