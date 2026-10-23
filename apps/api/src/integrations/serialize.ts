import type { Prisma } from '@prisma/client';

export const APPOINTMENT_API_INCLUDE = {
  doctor: { select: { id: true, displayName: true } },
  service: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  clinicPatient: { select: { id: true, name: true, phone: true, email: true } },
} satisfies Prisma.AppointmentInclude;

type Row = Prisma.AppointmentGetPayload<{ include: typeof APPOINTMENT_API_INCLUDE }>;

const STATUS: Record<string, string> = {
  BOOKED: 'booked', COMPLETED: 'completed', NO_SHOW: 'no_show', CANCELLED: 'cancelled', PENDING_PAYMENT: 'pending_payment',
};

/** Representación pública (API v1 y webhooks): estable, en inglés y sin datos clínicos. */
export function apiAppointment(a: Row) {
  return {
    id: a.id, status: STATUS[a.status] ?? a.status.toLowerCase(),
    startsAt: a.startsAt.toISOString(), endsAt: a.endsAt.toISOString(), durationMinutes: a.durationMinutes,
    modality: a.modality === 'VIDEO' ? 'video' : 'in_person',
    service: { id: a.service.id, name: a.serviceName },
    doctor: { id: a.doctor.id, name: a.doctor.displayName },
    location: { id: a.location.id, name: a.location.name },
    patient: { id: a.clinicPatient.id, name: a.clinicPatient.name, phone: a.clinicPatient.phone, email: a.clinicPatient.email },
    priceCents: a.priceCents, currency: 'MXN',
    source: a.source === 'ONLINE' ? 'online' : a.channel === 'api' ? 'api' : 'staff', channel: a.channel,
    notes: a.patientNotes, cancelReason: a.cancelReason, confirmedAt: a.confirmedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString(),
  };
}

/** Evento de la cita → tipo de webhook. */
export const WEBHOOK_TYPES: Record<string, string> = {
  CREATED: 'appointment.created', RESCHEDULED: 'appointment.rescheduled', CANCELLED: 'appointment.cancelled',
  COMPLETED: 'appointment.completed', NO_SHOW: 'appointment.no_show', CONFIRMED: 'appointment.confirmed',
  PAID: 'appointment.paid', REFUNDED: 'appointment.refunded',
};
export const WEBHOOK_EVENTS = Object.values(WEBHOOK_TYPES);
