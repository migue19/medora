-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "ReviewEventType" AS ENUM ('CREATED', 'HIDDEN', 'RESTORED', 'REPLIED', 'REPLY_REMOVED');


-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "reviewsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Review" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "clinicPatientId" UUID NOT NULL,
    "ratingPunctuality" INTEGER NOT NULL,
    "ratingTreatment" INTEGER NOT NULL,
    "ratingFacilities" INTEGER NOT NULL,
    "comment" VARCHAR(1000),
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "authorName" VARCHAR(60) NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
    "hiddenReason" VARCHAR(30),
    "reply" VARCHAR(1000),
    "replyAt" TIMESTAMPTZ(3),
    "replyByName" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewEvent" (
    "id" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "type" "ReviewEventType" NOT NULL,
    "actorKind" "ActorKind" NOT NULL,
    "actorId" UUID NOT NULL,
    "actorName" VARCHAR(120) NOT NULL,
    "reason" VARCHAR(30),
    "note" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewInvitation" (
    "id" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Review_appointmentId_key" ON "Review"("appointmentId");

-- CreateIndex
CREATE INDEX "Review_doctorId_status_createdAt_idx" ON "Review"("doctorId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Review_clinicId_createdAt_idx" ON "Review"("clinicId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewEvent_reviewId_createdAt_idx" ON "ReviewEvent"("reviewId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewInvitation_tokenHash_key" ON "ReviewInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "ReviewInvitation_appointmentId_idx" ON "ReviewInvitation"("appointmentId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Restricciones de negocio (Sprint 7)
ALTER TABLE "Review"
  ADD CONSTRAINT "Review_ratings" CHECK (
    "ratingPunctuality" BETWEEN 1 AND 5 AND "ratingTreatment" BETWEEN 1 AND 5 AND "ratingFacilities" BETWEEN 1 AND 5
  ),
  ADD CONSTRAINT "Review_hidden_reason" CHECK (("status" = 'HIDDEN') = ("hiddenReason" IS NOT NULL));

-- La opinión sólo puede existir para una cita atendida del mismo médico, paciente y clínica.
CREATE FUNCTION review_requires_completed_appointment() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Appointment" a
    WHERE a.id = NEW."appointmentId" AND a.status = 'COMPLETED' AND a."doctorId" = NEW."doctorId"
      AND a."clinicPatientId" = NEW."clinicPatientId" AND a."clinicId" = NEW."clinicId"
  ) THEN
    RAISE EXCEPTION 'review_requires_completed_appointment' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Review_completed_appointment" BEFORE INSERT ON "Review"
  FOR EACH ROW EXECUTE FUNCTION review_requires_completed_appointment();
