import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Payment, Prisma } from '@prisma/client';
import { APP_CONFIG, AppConfig } from '../config';
import { PrismaService, Tx } from '../prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { MailService } from '../mail/mail.service';
import { AppointmentsService, SYSTEM_ACTOR, lockDoctor } from '../appointments/appointments.service';
import { entitlements } from '../billing/plans';
import { BillingService } from '../billing/billing.service';
import { PAYMENT_GATEWAY, PaymentGateway, RefundError, verifyWebhook } from './gateway';
import {
  MAX_HOLD_MINUTES, PAYMENT_CLOSE_JOB, PAYMENT_EXPIRE_JOB, PAYMENT_REFUND_JOB, VOUCHER_HOURS, depositCents, payMethods,
} from './policy';

const MIN_SESSION_MINUTES = 31;

@Injectable()
export class PaymentsService implements OnModuleInit {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
    private readonly appointments: AppointmentsService,
    private readonly billing: BillingService,
  ) {}

  onModuleInit() {
    this.jobs.register(PAYMENT_EXPIRE_JOB, (p, now) => this.expireAppointment((p as { appointmentId: string }).appointmentId, now));
    this.jobs.register(PAYMENT_REFUND_JOB, (p) => this.refund((p as { paymentId: string }).paymentId));
    this.jobs.register(PAYMENT_CLOSE_JOB, (p) => this.close((p as { paymentId: string }).paymentId));
  }

  get available() {
    return this.config.payments !== null;
  }

  /** Política pública de la clínica (para mostrarla antes de reservar). */
  publicPolicy(clinic: { paymentMode: string; depositPercent: number; refundMinMinutes: number; asyncPaymentsEnabled: boolean }) {
    if (!this.available || clinic.paymentMode === 'OFF') return null;
    return {
      mode: clinic.paymentMode, depositPercent: clinic.depositPercent, refundMinMinutes: clinic.refundMinMinutes,
      asyncPayments: clinic.asyncPaymentsEnabled,
    };
  }

  /** Abre (o reutiliza) la página de pago de Stripe para una cita del paciente. */
  async checkout(patientAccountId: string, appointmentId: string, now = new Date()): Promise<{ url: string; expiresAt: Date }> {
    if (!this.available) throw new ConflictException('Los pagos en línea no están disponibles');
    const a = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, clinicPatient: { patientAccountId } },
      include: { clinic: true, doctor: { select: { displayName: true } }, clinicPatient: true },
    });
    if (!a) throw new NotFoundException('Cita no encontrada');
    const amount = depositCents(a.clinic, a.priceCents);
    if (!amount || a.clinic.paymentMode === 'OFF' || !entitlements(a.clinic).plan.features.payments) throw new ConflictException('Esta cita no se paga en línea');
    if (a.startsAt <= now) throw new ConflictException('La cita ya comenzó');
    if (a.status !== 'PENDING_PAYMENT' && a.status !== 'BOOKED') throw new ConflictException('La cita ya no está vigente');
    const payments = await this.prisma.payment.findMany({ where: { appointmentId: a.id }, orderBy: { createdAt: 'asc' } });
    if (payments.some((p) => p.status === 'PAID')) throw new ConflictException('Esta cita ya está pagada');
    const open = payments.find((p) => p.status === 'OPEN' || p.status === 'PROCESSING');
    if (open?.status === 'PROCESSING') throw new ConflictException('Ya tienes una ficha de pago emitida; págala antes de su vencimiento');
    if (open && open.checkoutUrl && open.expiresAt.getTime() - now.getTime() > 2 * 60_000) {
      return { url: open.checkoutUrl, expiresAt: open.expiresAt };
    }
    if (open) await this.closeOpen(open);

    // Un apartado sin pagar no se alarga sin fin: a lo más MAX_HOLD_MINUTES desde la reserva.
    let expiresAt = new Date(now.getTime() + MIN_SESSION_MINUTES * 60_000);
    if (a.status === 'PENDING_PAYMENT') {
      const limit = new Date(a.createdAt.getTime() + MAX_HOLD_MINUTES * 60_000);
      if (expiresAt > limit) throw new ConflictException('Se terminó el tiempo para pagar esta cita. Reserva de nuevo.');
      if (a.paymentDueAt && a.paymentDueAt > expiresAt) expiresAt = a.paymentDueAt;
    }
    const attempt = payments.length + 1;
    const session = await this.gateway.createCheckout({
      amountCents: amount,
      description: `${a.serviceName} · ${a.doctor.displayName} · ${a.clinic.name}`,
      customerEmail: a.clinicPatient.email ?? '',
      customerName: a.clinicPatient.name,
      methods: payMethods(a.clinic, a.startsAt, now),
      expiresAt,
      successUrl: `${this.config.webOrigin}/paciente?pago=listo`,
      cancelUrl: `${this.config.webOrigin}/paciente?pago=pendiente`,
      metadata: { appointmentId: a.id, clinicId: a.clinicId, attempt: String(attempt) },
      idempotencyKey: `checkout:${a.id}:${attempt}`,
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          clinicId: a.clinicId, appointmentId: a.id, checkoutId: session.id, checkoutUrl: session.url,
          amountCents: amount, expiresAt: session.expiresAt,
        },
      });
      if (a.status === 'PENDING_PAYMENT' && (!a.paymentDueAt || a.paymentDueAt < session.expiresAt)) {
        await tx.appointment.update({ where: { id: a.id }, data: { paymentDueAt: session.expiresAt } });
        await this.appointments.enqueueExpiry(tx, a.id, session.expiresAt);
      }
    });
    return { url: session.url, expiresAt: session.expiresAt };
  }

  /** Webhook de Stripe: firma verificada; un evento repetido no vuelve a aplicarse. */
  async webhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<{ received: true; duplicate?: true }> {
    if (!this.config.payments) throw new NotFoundException();
    if (!rawBody || !signature) throw new BadRequestException('Firma inválida');
    let event;
    try {
      event = verifyWebhook(rawBody, signature, this.config.payments);
    } catch {
      throw new BadRequestException('Firma inválida');
    }
    if (await this.prisma.paymentWebhookEvent.findUnique({ where: { id: event.id } })) return { received: true, duplicate: true };
    const object = event.data.object as unknown as {
      id: string; payment_intent?: string | null; amount_refunded?: number; mode?: string;
      subscription?: string | { id: string } | null; metadata?: Record<string, string>;
    };
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'invoice.paid':
      case 'invoice.payment_failed':
        await this.billing.handleEvent(event.type, object);
        break;
      case 'checkout.session.completed':
        if (object.mode === 'subscription') { await this.billing.handleEvent(event.type, object); break; }
        await this.sync(object.id);
        break;
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        // El estado se lee de Stripe, no del cuerpo del evento: el orden y las repeticiones no importan.
        await this.sync(object.id);
        break;
      case 'charge.refunded':
        if (object.payment_intent) await this.refundedAtProvider(object.payment_intent, object.amount_refunded ?? 0);
        break;
      default:
        break;
    }
    await this.prisma.paymentWebhookEvent.createMany({ data: [{ id: event.id, type: event.type }], skipDuplicates: true });
    return { received: true };
  }

  /** Concilia un intento de pago con el estado real en Stripe. Idempotente. */
  async sync(checkoutId: string, now = new Date()): Promise<Payment | null> {
    const known = await this.prisma.payment.findUnique({ where: { checkoutId } });
    if (!known) return null; // sesión de otra aplicación o de una cita borrada
    const state = await this.gateway.getCheckout(checkoutId);
    const appointment = await this.prisma.appointment.findUniqueOrThrow({ where: { id: known.appointmentId } });
    return this.prisma.$transaction(async (tx) => {
      await lockDoctor(tx, appointment.doctorId);
      const p = await tx.payment.findUniqueOrThrow({ where: { id: known.id } });
      const base = { paymentIntentId: state.paymentIntentId ?? p.paymentIntentId, method: state.method ?? p.method };
      if (state.state === 'paid') return this.markPaid(tx, p, base, now);
      if (p.status !== 'OPEN' && p.status !== 'PROCESSING') return p;
      if (state.state === 'voucher') {
        if (p.status === 'PROCESSING') return p;
        // Ficha OXXO o SPEI emitida: el apartado dura hasta que venza la ficha (y nunca después de la cita).
        const current = await tx.appointment.findUniqueOrThrow({ where: { id: p.appointmentId } });
        if (current.status === 'PENDING_PAYMENT') {
          const due = new Date(Math.min(now.getTime() + VOUCHER_HOURS * 3_600_000, current.startsAt.getTime() - 3_600_000));
          await tx.appointment.update({ where: { id: current.id }, data: { paymentDueAt: due } });
          await this.appointments.enqueueExpiry(tx, current.id, due);
        }
        return tx.payment.update({ where: { id: p.id }, data: { ...base, status: 'PROCESSING' } });
      }
      if (state.state === 'expired' || state.state === 'failed') {
        return tx.payment.update({ where: { id: p.id }, data: { ...base, status: state.state === 'expired' ? 'EXPIRED' : 'FAILED' } });
      }
      return p;
    });
  }

  /**
   * Pago aprobado. Confirma la cita apartada; si la cita ya se canceló o ya estaba pagada,
   * el cobro se reembolsa completo (nunca se queda dinero sin cita).
   */
  private async markPaid(tx: Tx, p: Payment, base: { paymentIntentId: string | null; method: string | null }, now: Date) {
    if (p.status === 'PAID' || p.status === 'REFUND_PENDING' || p.status === 'REFUNDED') return p;
    const appointment = await tx.appointment.findUniqueOrThrow({ where: { id: p.appointmentId } });
    const other = await tx.payment.count({ where: { appointmentId: p.appointmentId, status: 'PAID', id: { not: p.id } } });
    const reason = other ? 'Pago duplicado' : appointment.status === 'CANCELLED' ? 'La cita ya estaba cancelada' : null;
    if (reason) {
      const updated = await tx.payment.update({
        where: { id: p.id }, data: { ...base, status: 'REFUND_PENDING', paidAt: now, refundReason: reason },
      });
      await this.jobs.enqueue(tx, { type: PAYMENT_REFUND_JOB, payload: { paymentId: p.id }, dedupeKey: `payment-refund:${p.id}` });
      return updated;
    }
    const updated = await tx.payment.update({ where: { id: p.id }, data: { ...base, status: 'PAID', paidAt: now } });
    await this.appointments.confirmPaid(tx, appointment, p.amountCents, now);
    return updated;
  }

  /** Trabajo: vence el apartado de una cita sin pagar (antes concilia por si se perdió un webhook). */
  async expireAppointment(appointmentId: string, now = new Date()) {
    const a = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!a || a.status !== 'PENDING_PAYMENT' || !a.paymentDueAt || a.paymentDueAt > now) return;
    const open = await this.prisma.payment.findMany({ where: { appointmentId, status: { in: ['OPEN', 'PROCESSING'] } } });
    for (const p of open) await this.sync(p.checkoutId, now);
    await this.appointments.expireUnpaid(appointmentId, now);
  }

  /** Trabajo: cierra en Stripe un intento abierto de una cita cancelada (y concilia por si se pagó). */
  async close(paymentId: string) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p || (p.status !== 'OPEN' && p.status !== 'PROCESSING')) return;
    await this.closeOpen(p);
  }

  private async closeOpen(p: Payment) {
    if (p.status === 'OPEN') await this.gateway.expireCheckout(p.checkoutId).catch(() => undefined);
    const synced = await this.sync(p.checkoutId);
    if (synced && (synced.status === 'OPEN')) {
      await this.prisma.payment.updateMany({ where: { id: p.id, status: 'OPEN' }, data: { status: 'EXPIRED' } });
    }
  }

  /** Trabajo: reembolsa en Stripe. Errores temporales se reintentan; los permanentes quedan para revisión manual. */
  async refund(paymentId: string) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p || p.status !== 'REFUND_PENDING') return;
    if (!p.paymentIntentId) {
      await this.prisma.payment.update({ where: { id: p.id }, data: { lastError: 'Sin referencia de pago en Stripe' } });
      return;
    }
    try {
      await this.gateway.refund(p.paymentIntentId, p.amountCents - p.refundedCents, `refund:${p.id}`);
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await this.prisma.payment.update({ where: { id: p.id }, data: { lastError: message } });
      if (e instanceof RefundError && e.permanent) return;
      throw e;
    }
    await this.completeRefund(p.id, p.amountCents);
  }

  /** Reembolso hecho directamente en el panel de Stripe (o confirmación del nuestro). */
  private async refundedAtProvider(paymentIntentId: string, amountRefunded: number) {
    const p = await this.prisma.payment.findUnique({ where: { paymentIntentId } });
    if (!p || amountRefunded <= 0) return;
    await this.completeRefund(p.id, Math.min(amountRefunded, p.amountCents));
  }

  private async completeRefund(paymentId: string, refundedCents: number, manual = false) {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Payment[]>`SELECT * FROM "Payment" WHERE id = ${paymentId}::uuid FOR UPDATE`;
      const p = rows[0];
      if (!p || p.status === 'REFUNDED' || refundedCents < p.refundedCents) return;
      const full = refundedCents >= p.amountCents;
      await tx.payment.update({
        where: { id: p.id },
        data: {
          refundedCents, lastError: null,
          ...(full ? { status: 'REFUNDED', refundedAt: new Date(), refundReason: p.refundReason ?? (manual ? 'Reembolso manual' : 'Reembolso desde Stripe') } : {}),
        },
      });
      if (!full) return;
      const event = await tx.appointmentEvent.create({
        data: {
          appointmentId: p.appointmentId, type: 'REFUNDED', actorKind: SYSTEM_ACTOR.kind, actorId: SYSTEM_ACTOR.id,
          actorName: SYSTEM_ACTOR.name, reason: `Reembolso de ${(refundedCents / 100).toFixed(2)} MXN`,
        },
      });
      await this.mail.paymentRefunded(tx, event.id, refundedCents);
    });
  }

  // ---------------------------------------------------------------- panel

  /** Conciliación: pagos del periodo con su cita, totales y lo que requiere atención. */
  async report(clinicId: string, from: Date, to: Date, now = new Date()) {
    const rows = await this.prisma.payment.findMany({
      where: { clinicId, createdAt: { gte: from, lt: to }, status: { notIn: ['EXPIRED', 'FAILED'] } },
      include: {
        appointment: {
          select: {
            id: true, startsAt: true, status: true, serviceName: true, priceCents: true,
            doctor: { select: { displayName: true } }, clinicPatient: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const stuck = await this.prisma.appointment.findMany({
      where: { clinicId, status: 'PENDING_PAYMENT', paymentDueAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
      select: { id: true, startsAt: true, paymentDueAt: true, clinicPatient: { select: { name: true } } },
    });
    const flag = (p: (typeof rows)[number]): string | null => {
      if (p.status === 'PAID' && p.appointment.status === 'CANCELLED') return 'Cobrado con la cita cancelada y sin reembolso';
      if (p.status === 'REFUND_PENDING' && p.lastError) return `Reembolso con error: ${p.lastError}`;
      if (p.status === 'REFUND_PENDING' && now.getTime() - p.updatedAt.getTime() > 24 * 3_600_000) return 'Reembolso pendiente desde hace más de un día';
      return null;
    };
    const paid = rows.filter((p) => p.paidAt);
    return {
      totals: {
        chargedCents: paid.reduce((s, p) => s + p.amountCents, 0),
        refundedCents: paid.reduce((s, p) => s + p.refundedCents, 0),
        netCents: paid.reduce((s, p) => s + p.amountCents - p.refundedCents, 0),
        count: paid.length,
      },
      payments: rows.map((p) => ({
        id: p.id, status: p.status, method: p.method, amountCents: p.amountCents, refundedCents: p.refundedCents,
        createdAt: p.createdAt, paidAt: p.paidAt, refundedAt: p.refundedAt, refundReason: p.refundReason,
        appointment: {
          id: p.appointment.id, startsAt: p.appointment.startsAt, status: p.appointment.status, serviceName: p.appointment.serviceName,
          doctorName: p.appointment.doctor.displayName, patientName: p.appointment.clinicPatient.name,
        },
        attention: flag(p),
      })),
      overdue: stuck.map((a) => ({ appointmentId: a.id, startsAt: a.startsAt, paymentDueAt: a.paymentDueAt, patientName: a.clinicPatient.name })),
    };
  }

  /** Volver a consultar en Stripe un pago (botón «Conciliar» del panel). */
  async resync(clinicId: string, paymentId: string) {
    const p = await this.prisma.payment.findFirst({ where: { id: paymentId, clinicId } });
    if (!p) throw new NotFoundException('Pago no encontrado');
    await this.sync(p.checkoutId);
    if (p.status === 'REFUND_PENDING') await this.refund(p.id).catch(() => undefined);
    return this.prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
  }

  /** Reembolso que la clínica resolvió por fuera (p. ej. pago en OXXO, que Stripe no reembolsa). */
  async markRefundedManually(clinicId: string, paymentId: string) {
    const p = await this.prisma.payment.findFirst({ where: { id: paymentId, clinicId } });
    if (!p) throw new NotFoundException('Pago no encontrado');
    if (p.status !== 'REFUND_PENDING') throw new ConflictException('Sólo se marcan reembolsos pendientes');
    await this.completeRefund(p.id, p.amountCents, true);
    return this.prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
  }

  /** Resumen de pago de varias citas (agenda, ficha y portal del paciente). */
  async summaries(appointmentIds: string[]) {
    if (!appointmentIds.length) return new Map<string, PaymentSummary>();
    const rows = await this.prisma.payment.findMany({
      where: { appointmentId: { in: appointmentIds }, status: { in: ['PAID', 'REFUND_PENDING', 'REFUNDED', 'PROCESSING', 'OPEN'] } },
      orderBy: { createdAt: 'asc' },
    });
    const map = new Map<string, PaymentSummary>();
    for (const p of rows) {
      const prev = map.get(p.appointmentId);
      // Lo cobrado manda sobre los intentos abiertos.
      if (prev && prev.status !== 'OPEN' && prev.status !== 'PROCESSING') continue;
      map.set(p.appointmentId, { status: p.status, amountCents: p.amountCents, refundedCents: p.refundedCents, method: p.method });
    }
    return map;
  }
}

export interface PaymentSummary {
  status: Prisma.PaymentGetPayload<object>['status'];
  amountCents: number;
  refundedCents: number;
  method: string | null;
}
