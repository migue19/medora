-- Resumen semanal por correo (activado por omisión).
ALTER TABLE "Clinic" ADD COLUMN "weeklyReport" BOOLEAN NOT NULL DEFAULT true;

-- Reportes por periodo: citas por clínica y fecha de inicio ya tienen índice; eventos de cancelación por cita.
CREATE INDEX IF NOT EXISTS "AppointmentEvent_type_appointment" ON "AppointmentEvent" (type, "appointmentId");
