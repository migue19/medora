-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('CONSULTORIO', 'CLINICA', 'PLUS');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "ClinicVerification" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CfdiStatus" AS ENUM ('PENDING', 'ISSUED', 'SKIPPED', 'FAILED');

-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "billingExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "currentPeriodEnd" TIMESTAMPTZ(3),
ADD COLUMN     "plan" "Plan" NOT NULL DEFAULT 'CLINICA',
ADD COLUMN     "stripeCustomerId" VARCHAR(255),
ADD COLUMN     "stripeSubscriptionId" VARCHAR(255),
ADD COLUMN     "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
ADD COLUMN     "trialEndsAt" TIMESTAMPTZ(3),
ADD COLUMN     "verification" "ClinicVerification" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "verificationNote" VARCHAR(300),
ADD COLUMN     "verifiedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "ClinicBilling" (
    "clinicId" UUID NOT NULL,
    "rfc" VARCHAR(13) NOT NULL,
    "legalName" VARCHAR(254) NOT NULL,
    "fiscalRegime" VARCHAR(3) NOT NULL,
    "zipCode" VARCHAR(5) NOT NULL,
    "cfdiUse" VARCHAR(4) NOT NULL DEFAULT 'G03',
    "email" VARCHAR(254) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClinicBilling_pkey" PRIMARY KEY ("clinicId")
);

-- CreateTable
CREATE TABLE "SubscriptionInvoice" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "stripeInvoiceId" VARCHAR(255) NOT NULL,
    "plan" "Plan" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "paidAt" TIMESTAMPTZ(3) NOT NULL,
    "cardFunding" VARCHAR(10),
    "cfdiStatus" "CfdiStatus" NOT NULL DEFAULT 'PENDING',
    "cfdiId" VARCHAR(64),
    "cfdiUuid" VARCHAR(40),
    "cfdiError" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_stripeInvoiceId_key" ON "SubscriptionInvoice"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "SubscriptionInvoice_clinicId_paidAt_idx" ON "SubscriptionInvoice"("clinicId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Clinic_stripeCustomerId_key" ON "Clinic"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Clinic_stripeSubscriptionId_key" ON "Clinic"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "ClinicBilling" ADD CONSTRAINT "ClinicBilling_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Clínicas existentes (piloto y demo): exentas, con todo incluido y ya verificadas.
UPDATE "Clinic" SET "billingExempt" = true, plan = 'PLUS', "subscriptionStatus" = 'ACTIVE', verification = 'VERIFIED', "verifiedAt" = now();

ALTER TABLE "ClinicBilling"
  ADD CONSTRAINT "ClinicBilling_rfc" CHECK (rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  ADD CONSTRAINT "ClinicBilling_zip" CHECK ("zipCode" ~ '^[0-9]{5}$'),
  ADD CONSTRAINT "ClinicBilling_regime" CHECK ("fiscalRegime" ~ '^[0-9]{3}$');
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_amount" CHECK ("amountCents" > 0);

