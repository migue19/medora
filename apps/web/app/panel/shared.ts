export interface Service { id: string; name: string; durationMinutes: number; priceCents: number; active: boolean }
export interface Rule { weekday: number; startMinute: number; endMinute: number }
export interface Doctor {
  id: string; displayName: string; specialty: string; licenseNumber: string | null; bio: string | null; active: boolean;
  serviceIds: string[]; rules: Rule[];
  membership: { id: string; user: { name: string; email: string } } | null;
}
export interface ClinicPatient {
  id: string; name: string; phone: string; email: string | null; patientAccountId: string | null; whatsappConsent?: boolean;
  tags?: string[]; linked?: boolean;
}
export interface ReminderLog { channel: 'EMAIL' | 'WHATSAPP'; offsetMinutes: number | null; status: 'SENT' | 'FAILED' | 'SKIPPED'; error: string | null; createdAt: string }
export interface Appointment {
  id: string; startsAt: string; endsAt: string; status: 'BOOKED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW'; source: string;
  serviceId: string; serviceName: string; durationMinutes: number; priceCents: number; patientNotes: string | null;
  cancelReason: string | null; doctor: { id: string; displayName: string }; patient: ClinicPatient;
  confirmedAt: string | null; reminders: ReminderLog[]; followUpOfId: string | null;
}
