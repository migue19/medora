-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('OFF', 'OPTIONAL', 'REQUIRED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('OPEN', 'PROCESSING', 'PAID', 'EXPIRED', 'FAILED', 'REFUND_PENDING', 'REFUNDED');

-- AlterEnum
ALTER TYPE "ActorKind" ADD VALUE 'SYSTEM';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AppointmentEventType" ADD VALUE 'PAID';
ALTER TYPE "AppointmentEventType" ADD VALUE 'REFUNDED';

-- AlterEnum
ALTER TYPE "AppointmentStatus" ADD VALUE 'PENDING_PAYMENT';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "paymentDueAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "asyncPaymentsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "depositPercent" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "paymentMode" "PaymentMode" NOT NULL DEFAULT 'OFF',
ADD COLUMN     "refundMinMinutes" INTEGER NOT NULL DEFAULT 1440;

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL DEFAULT 'stripe',
    "checkoutId" VARCHAR(255) NOT NULL,
    "checkoutUrl" VARCHAR(1000),
    "paymentIntentId" VARCHAR(255),
    "amountCents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'mxn',
    "status" "PaymentStatus" NOT NULL DEFAULT 'OPEN',
    "method" VARCHAR(30),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "paidAt" TIMESTAMPTZ(3),
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "refundReason" VARCHAR(200),
    "refundedAt" TIMESTAMPTZ(3),
    "lastError" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" VARCHAR(255) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_checkoutId_key" ON "Payment"("checkoutId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentIntentId_key" ON "Payment"("paymentIntentId");

-- CreateIndex
CREATE INDEX "Payment_appointmentId_idx" ON "Payment"("appointmentId");

-- CreateIndex
CREATE INDEX "Payment_clinicId_createdAt_idx" ON "Payment"("clinicId", "createdAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Políticas de pago dentro de rango.
ALTER TABLE "Clinic"
  ADD CONSTRAINT "Clinic_deposit_percent" CHECK ("depositPercent" BETWEEN 10 AND 100),
  ADD CONSTRAINT "Clinic_refund_window" CHECK ("refundMinMinutes" BETWEEN 0 AND 10080);

-- Una cita pendiente de pago siempre tiene fecha límite (texto: el valor nuevo del enum aún no se puede usar aquí).
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_payment_due" CHECK ("status"::text <> 'PENDING_PAYMENT' OR "paymentDueAt" IS NOT NULL);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount" CHECK ("amountCents" > 0),
  ADD CONSTRAINT "Payment_refunded" CHECK ("refundedCents" BETWEEN 0 AND "amountCents"),
  ADD CONSTRAINT "Payment_paid_at" CHECK ("status" NOT IN ('PAID', 'REFUND_PENDING', 'REFUNDED') OR "paidAt" IS NOT NULL);

-- A lo más un intento abierto y a lo más un pago cobrado por cita (un segundo cobro se reembolsa).
CREATE UNIQUE INDEX "Payment_one_open" ON "Payment" ("appointmentId") WHERE "status" IN ('OPEN', 'PROCESSING');
CREATE UNIQUE INDEX "Payment_one_paid" ON "Payment" ("appointmentId") WHERE "status" = 'PAID';
