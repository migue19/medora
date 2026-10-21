export type VisitType = 'ANY' | 'FIRST' | 'FOLLOW_UP';
export interface Service { id: string; name: string; durationMinutes: number; priceCents: number; active: boolean; visitType: VisitType }
export interface Rule { weekday: number; startMinute: number; endMinute: number; locationId?: string; roomId?: string | null }
export interface Hours { weekday: number; startMinute: number; endMinute: number }
export interface Room { id: string; name: string; active: boolean }
export interface Location {
  id: string; name: string; address: string | null; phone: string | null; mapUrl: string | null; active: boolean;
  sortOrder: number; hours: Hours[]; rooms: Room[];
}
export interface Doctor {
  id: string; displayName: string; specialty: string; licenseNumber: string | null; bio: string | null; active: boolean;
  serviceIds: string[]; rules: Rule[]; photoUrl?: string | null; slug?: string;
  education?: string[]; certifications?: string[]; languages?: string[]; conditions?: string[]; insurers?: string[];
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
  location?: { id: string; name: string }; room?: { id: string; name: string } | null; channel?: string | null;
}
