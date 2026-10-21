-- CreateEnum
CREATE TYPE "PatientAuditAction" AS ENUM ('CREATED', 'UPDATED', 'LINK_REQUESTED', 'LINKED', 'MERGED');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'BOOKED', 'REMOVED');

-- CreateEnum
CREATE TYPE "WaitlistOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'RELEASED');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "followUpOfId" UUID;

-- AlterTable
ALTER TABLE "ClinicPatient" ADD COLUMN     "mergedIntoId" UUID,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "PatientNote" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "clinicPatientId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "authorName" VARCHAR(120) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientAudit" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "clinicPatientId" UUID NOT NULL,
    "action" "PatientAuditAction" NOT NULL,
    "actorKind" "ActorKind" NOT NULL,
    "actorId" UUID NOT NULL,
    "actorName" VARCHAR(120) NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientLinkRequest" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "clinicPatientId" UUID NOT NULL,
    "patientAccountId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "requestedById" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientLinkRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "clinicPatientId" UUID NOT NULL,
    "fromDate" CHAR(10),
    "toDate" CHAR(10),
    "notes" VARCHAR(300),
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "appointmentId" UUID,
    "createdByKind" "ActorKind" NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistOffer" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "status" "WaitlistOfferStatus" NOT NULL DEFAULT 'PENDING',
    "appointmentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WaitlistOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientNote_clinicPatientId_createdAt_idx" ON "PatientNote"("clinicPatientId", "createdAt");

-- CreateIndex
CREATE INDEX "PatientAudit_clinicPatientId_createdAt_idx" ON "PatientAudit"("clinicPatientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PatientLinkRequest_tokenHash_key" ON "PatientLinkRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "PatientLinkRequest_clinicPatientId_idx" ON "PatientLinkRequest"("clinicPatientId");

-- CreateIndex
CREATE INDEX "WaitlistEntry_doctorId_status_createdAt_idx" ON "WaitlistEntry"("doctorId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WaitlistEntry_clinicId_status_idx" ON "WaitlistEntry"("clinicId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistOffer_tokenHash_key" ON "WaitlistOffer"("tokenHash");

-- CreateIndex
CREATE INDEX "WaitlistOffer_doctorId_status_startsAt_idx" ON "WaitlistOffer"("doctorId", "status", "startsAt");

-- AddForeignKey
ALTER TABLE "PatientNote" ADD CONSTRAINT "PatientNote_clinicPatientId_fkey" FOREIGN KEY ("clinicPatientId") REFERENCES "ClinicPatient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAudit" ADD CONSTRAINT "PatientAudit_clinicPatientId_fkey" FOREIGN KEY ("clinicPatientId") REFERENCES "ClinicPatient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_clinicPatientId_fkey" FOREIGN KEY ("clinicPatientId") REFERENCES "ClinicPatient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistOffer" ADD CONSTRAINT "WaitlistOffer_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "WaitlistEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Restricciones de negocio (Sprint 4)
ALTER TABLE "ClinicPatient"
  ADD CONSTRAINT "ClinicPatient_tags" CHECK (cardinality("tags") <= 10),
  ADD CONSTRAINT "ClinicPatient_not_self_merged" CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> "id"),
  ADD CONSTRAINT "ClinicPatient_merged_unlinked" CHECK ("mergedIntoId" IS NULL OR "patientAccountId" IS NULL);

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_followUp_fkey" FOREIGN KEY ("followUpOfId") REFERENCES "Appointment"("id"),
  ADD CONSTRAINT "Appointment_followUp_not_self" CHECK ("followUpOfId" IS NULL OR "followUpOfId" <> "id");

ALTER TABLE "WaitlistEntry"
  ADD CONSTRAINT "WaitlistEntry_dates" CHECK (
    ("fromDate" IS NULL OR "fromDate" ~ '^\d{4}-\d{2}-\d{2}$') AND ("toDate" IS NULL OR "toDate" ~ '^\d{4}-\d{2}-\d{2}$')
    AND ("fromDate" IS NULL OR "toDate" IS NULL OR "fromDate" <= "toDate")
  );

-- Un paciente no se anota dos veces con el mismo médico y servicio mientras espera.
CREATE UNIQUE INDEX "WaitlistEntry_one_waiting" ON "WaitlistEntry" ("clinicPatientId", "doctorId", "serviceId")
  WHERE "status" = 'WAITING';

-- Una persona tiene como máximo una oferta pendiente a la vez.
CREATE UNIQUE INDEX "WaitlistOffer_one_pending_per_entry" ON "WaitlistOffer" ("entryId") WHERE "status" = 'PENDING';

ALTER TABLE "WaitlistOffer"
  ADD CONSTRAINT "WaitlistOffer_range" CHECK ("endsAt" > "startsAt"),
  -- Dos apartados pendientes del mismo médico no pueden traslaparse.
  ADD CONSTRAINT "WaitlistOffer_no_overlap" EXCLUDE USING gist (
    "doctorId" WITH =, tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("status" = 'PENDING');
