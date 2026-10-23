import type { Appointment, Clinic } from '@prisma/client';
import type { Actor } from '../appointments/appointments.service';
import { JobsService } from '../jobs/jobs.service';
import { Tx } from '../prisma.service';
import type { PayMethod } from './gateway';
import { entitlements } from '../billing/plans';

/** Stripe no cobra menos de $10.00 MXN: debajo de eso no se pide pago en línea. */
export const MIN_CHARGE_CENTS = 1000;
/** Tiempo para pagar al reservar (la sesión de Stripe dura al menos 30 min). */
export const PAYMENT_HOLD_MINUTES = 35;
/** Ningún apartado sin pagar dura más de esto desde la reserva (salvo ficha OXXO o SPEI emitida). */
export const MAX_HOLD_MINUTES = 120;
/** OXXO y SPEI tardan en acreditarse: sólo para citas con al menos esta anticipación. */
export const ASYNC_MIN_LEAD_HOURS = 72;
/** Plazo para pagar una ficha OXXO o una transferencia SPEI ya emitida. */
export const VOUCHER_HOURS = 48;

export const PAYMENT_REFUND_JOB = 'payment.refund';
export const PAYMENT_EXPIRE_JOB = 'payment.expire';
export const PAYMENT_CLOSE_JOB = 'payment.close';

/** Monto a cobrar en línea por una cita (anticipo o total), o null si no aplica. */
export function depositCents(clinic: Pick<Clinic, 'depositPercent'>, priceCents: number): number | null {
  const amount = Math.round((priceCents * clinic.depositPercent) / 100);
  return amount >= MIN_CHARGE_CENTS ? amount : null;
}

/** La reserva en línea queda pendiente de pago (aparta el horario) en vez de agendada. */
export function requiresPayment(paymentsAvailable: boolean, clinic: Clinic, priceCents: number): boolean {
  return paymentsAvailable && clinic.paymentMode === 'REQUIRED' && entitlements(clinic).plan.features.payments && depositCents(clinic, priceCents) !== null;
}

export function payMethods(clinic: Clinic, startsAt: Date, now: Date): PayMethod[] {
  const async = clinic.asyncPaymentsEnabled && startsAt.getTime() - now.getTime() >= ASYNC_MIN_LEAD_HOURS * 3_600_000;
  return async ? ['card', 'oxxo', 'spei'] : ['card'];
}

/** Política de reembolso al cancelar: la clínica siempre reembolsa; el paciente, sólo dentro del plazo. */
export function refundable(clinic: Clinic, appointment: Pick<Appointment, 'startsAt'>, actor: Actor, now: Date): boolean {
  if (actor.kind !== 'PATIENT') return true;
  return appointment.startsAt.getTime() - now.getTime() >= clinic.refundMinMinutes * 60_000;
}

/**
 * Al cancelar una cita (misma transacción): reembolsa el pago cobrado si la política lo permite
 * y cierra los intentos de pago abiertos para que ya no se puedan pagar.
 */
export async function settleOnCancel(tx: Tx, jobs: JobsService, clinic: Clinic, appointment: Appointment, actor: Actor, now: Date) {
  const payments = await tx.payment.findMany({ where: { appointmentId: appointment.id, status: { in: ['OPEN', 'PROCESSING', 'PAID'] } } });
  for (const p of payments) {
    if (p.status === 'PAID') {
      if (!refundable(clinic, appointment, actor, now)) continue;
      await tx.payment.update({
        where: { id: p.id },
        data: { status: 'REFUND_PENDING', refundReason: actor.kind === 'PATIENT' ? 'Cancelada a tiempo por el paciente' : 'Cancelada por la clínica' },
      });
      await jobs.enqueue(tx, { type: PAYMENT_REFUND_JOB, payload: { paymentId: p.id }, dedupeKey: `payment-refund:${p.id}` });
    } else {
      await jobs.enqueue(tx, { type: PAYMENT_CLOSE_JOB, payload: { paymentId: p.id }, dedupeKey: `payment-close:${p.id}` });
    }
  }
}
