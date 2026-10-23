import { ForbiddenException } from '@nestjs/common';
import type { Clinic, Plan } from '@prisma/client';

export type Feature = 'whatsapp' | 'telemedicine' | 'payments' | 'attachments' | 'exports';

export interface PlanInfo {
  name: string;
  /** Precio mensual en centavos, IVA incluido. */
  priceCents: number;
  maxDoctors: number;
  features: Record<Feature, boolean>;
  summary: string[];
}

export const PLANS: Record<Plan, PlanInfo> = {
  CONSULTORIO: {
    name: 'Consultorio', priceCents: 49_900, maxDoctors: 1,
    features: { whatsapp: false, telemedicine: false, payments: false, attachments: false, exports: false },
    summary: ['1 médico', 'Agenda y reservas en línea', 'Recordatorios por correo', 'Expediente clínico y recetas', 'Directorio y opiniones'],
  },
  CLINICA: {
    name: 'Clínica', priceCents: 129_900, maxDoctors: 5,
    features: { whatsapp: true, telemedicine: true, payments: true, attachments: false, exports: false },
    summary: ['Hasta 5 médicos', 'Todo lo de Consultorio', 'Recordatorios por WhatsApp', 'Videoconsultas', 'Cobro en línea'],
  },
  PLUS: {
    name: 'Plus', priceCents: 249_900, maxDoctors: 15,
    features: { whatsapp: true, telemedicine: true, payments: true, attachments: true, exports: true },
    summary: ['Hasta 15 médicos', 'Todo lo de Clínica', 'Estudios y archivos en el expediente', 'Exportación de reportes a Excel'],
  },
};

export const TRIAL_DAYS = 14;
/** Tras un cobro fallido, la clínica sigue operando estos días mientras actualiza su tarjeta. */
export const GRACE_DAYS = 7;

const FEATURE_NAME: Record<Feature, string> = {
  whatsapp: 'los recordatorios por WhatsApp', telemedicine: 'las videoconsultas', payments: 'el cobro en línea', attachments: 'los archivos en el expediente',
  exports: 'la exportación de reportes',
};

type BillingFields = Pick<Clinic, 'plan' | 'subscriptionStatus' | 'trialEndsAt' | 'currentPeriodEnd' | 'billingExempt'>;

/** Plan efectivo y si la suscripción está vigente (las exentas tienen todo incluido). */
export function entitlements(c: BillingFields, now = new Date()) {
  const plan = c.billingExempt ? PLANS.PLUS : PLANS[c.plan];
  let active: boolean;
  if (c.billingExempt) active = true;
  else if (c.subscriptionStatus === 'ACTIVE') active = true;
  else if (c.subscriptionStatus === 'TRIALING') active = !c.trialEndsAt || c.trialEndsAt > now;
  else if (c.subscriptionStatus === 'PAST_DUE') active = !c.currentPeriodEnd || c.currentPeriodEnd.getTime() + GRACE_DAYS * 86_400_000 > now.getTime();
  else active = false;
  return { active, plan, planKey: c.billingExempt ? 'PLUS' as Plan : c.plan };
}

export function assertFeature(c: BillingFields, feature: Feature) {
  const e = entitlements(c);
  if (!e.plan.features[feature]) {
    const upgrade = (Object.keys(PLANS) as Plan[]).find((k) => PLANS[k].features[feature]);
    throw new ForbiddenException(`Tu plan ${e.plan.name} no incluye ${FEATURE_NAME[feature]}. Cámbialo al plan ${PLANS[upgrade!].name} en «Suscripción».`);
  }
}

/** Reservas en línea: la clínica las tiene activadas y su suscripción está vigente. */
export function canBookOnline(c: BillingFields & Pick<Clinic, 'bookingEnabled'>, now = new Date()) {
  return c.bookingEnabled && entitlements(c, now).active;
}

/** Médicos activos permitidos por el plan (dentro de la transacción que crea o reactiva uno). */
export async function assertDoctorSlot(tx: { clinic: { findUniqueOrThrow: (a: { where: { id: string } }) => Promise<Clinic> }; doctor: { count: (a: object) => Promise<number> } }, clinicId: string, excludeDoctorId: string | null = null) {
  const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: clinicId } });
  const { plan } = entitlements(clinic);
  const active = await tx.doctor.count({ where: { clinicId, active: true, ...(excludeDoctorId ? { id: { not: excludeDoctorId } } : {}) } });
  if (active >= plan.maxDoctors) {
    throw new ForbiddenException(plan.maxDoctors === 1
      ? `Tu plan ${plan.name} incluye 1 médico. Cambia de plan en «Suscripción» para agregar más.`
      : `Tu plan ${plan.name} incluye hasta ${plan.maxDoctors} médicos activos. Cambia de plan en «Suscripción» para agregar más.`);
  }
}
