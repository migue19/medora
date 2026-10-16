-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- AlterEnum
ALTER TYPE "AppointmentEventType" ADD VALUE 'CONFIRMED';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "confirmedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "reminderOffsets" INTEGER[] DEFAULT ARRAY[1440, 120]::INTEGER[],
ADD COLUMN     "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ClinicPatient" ADD COLUMN     "whatsappConsentAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "PatientAccount" ADD COLUMN     "whatsappConsentAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "AppointmentActionToken" (
    "id" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentActionToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "offsetMinutes" INTEGER,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "recipient" VARCHAR(254),
    "providerId" VARCHAR(200),
    "error" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentActionToken_tokenHash_key" ON "AppointmentActionToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AppointmentActionToken_appointmentId_idx" ON "AppointmentActionToken"("appointmentId");

-- CreateIndex
CREATE INDEX "NotificationLog_appointmentId_idx" ON "NotificationLog"("appointmentId");

-- CreateIndex
CREATE INDEX "NotificationLog_clinicId_createdAt_idx" ON "NotificationLog"("clinicId", "createdAt");

-- AddForeignKey
ALTER TABLE "AppointmentActionToken" ADD CONSTRAINT "AppointmentActionToken_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Restricciones de negocio (Sprint 3)
ALTER TABLE "Clinic"
  ADD CONSTRAINT "Clinic_reminder_offsets" CHECK (
    cardinality("reminderOffsets") <= 3 AND 30 <= ALL ("reminderOffsets") AND 10080 >= ALL ("reminderOffsets")
  );

-- Un recordatorio se envía como máximo una vez por cita, horario, anticipación y canal.
CREATE UNIQUE INDEX "NotificationLog_one_sent" ON "NotificationLog" ("appointmentId", "channel", "offsetMinutes", "startsAt")
  WHERE "status" = 'SENT';
