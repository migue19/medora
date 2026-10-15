-- CreateEnum
CREATE TYPE "AuthTokenKind" AS ENUM ('PATIENT_VERIFY_EMAIL', 'PATIENT_RESET_PASSWORD', 'STAFF_RESET_PASSWORD');

-- AlterTable
ALTER TABLE "PatientAccount" ADD COLUMN     "emailVerifiedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" UUID NOT NULL,
    "kind" "AuthTokenKind" NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "patientAccountId" UUID,
    "userId" UUID,
    "email" VARCHAR(254) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffInvitation" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "role" "StaffRole" NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "invitedById" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "membershipId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" VARCHAR(200),
    "runAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "lockedUntil" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "lastError" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthToken_patientAccountId_idx" ON "AuthToken"("patientAccountId");

-- CreateIndex
CREATE INDEX "AuthToken_userId_idx" ON "AuthToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffInvitation_tokenHash_key" ON "StaffInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "StaffInvitation_clinicId_idx" ON "StaffInvitation"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_patientAccountId_fkey" FOREIGN KEY ("patientAccountId") REFERENCES "PatientAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Restricciones de negocio (Sprint 2)
ALTER TABLE "AuthToken"
  ADD CONSTRAINT "AuthToken_owner" CHECK (
    ("kind" IN ('PATIENT_VERIFY_EMAIL', 'PATIENT_RESET_PASSWORD') AND "patientAccountId" IS NOT NULL AND "userId" IS NULL) OR
    ("kind" = 'STAFF_RESET_PASSWORD' AND "userId" IS NOT NULL AND "patientAccountId" IS NULL)
  ),
  ADD CONSTRAINT "AuthToken_expiry" CHECK ("expiresAt" > "createdAt");

ALTER TABLE "StaffInvitation"
  ADD CONSTRAINT "StaffInvitation_role" CHECK ("role" <> 'OWNER'),
  ADD CONSTRAINT "StaffInvitation_final_state" CHECK ("acceptedAt" IS NULL OR "revokedAt" IS NULL);

-- Una sola invitación pendiente por correo y clínica.
CREATE UNIQUE INDEX "StaffInvitation_one_pending" ON "StaffInvitation" ("clinicId", "email")
  WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_attempts" CHECK ("attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 50);

-- Índice para que el trabajador sólo recorra trabajos pendientes.
CREATE INDEX "Job_pending" ON "Job" ("runAt") WHERE "completedAt" IS NULL AND "failedAt" IS NULL;
