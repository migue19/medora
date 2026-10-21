-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IMPORTED');


-- AlterTable
ALTER TABLE "StaffInvitation" ADD COLUMN     "doctorId" UUID;

-- CreateTable
CREATE TABLE "ClinicOnboarding" (
    "id" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "contactEmail" VARCHAR(254),
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" "OnboardingStatus" NOT NULL DEFAULT 'DRAFT',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "submittedAt" TIMESTAMPTZ(3),
    "importedAt" TIMESTAMPTZ(3),
    "clinicId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClinicOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingPhoto" (
    "onboardingId" UUID NOT NULL,
    "doctorKey" VARCHAR(40) NOT NULL,
    "mimeType" VARCHAR(20) NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OnboardingPhoto_pkey" PRIMARY KEY ("onboardingId","doctorKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicOnboarding_tokenHash_key" ON "ClinicOnboarding"("tokenHash");

-- AddForeignKey
ALTER TABLE "OnboardingPhoto" ADD CONSTRAINT "OnboardingPhoto_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "ClinicOnboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "OnboardingPhoto"
  ADD CONSTRAINT "OnboardingPhoto_type" CHECK ("mimeType" IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT "OnboardingPhoto_size" CHECK (octet_length("data") BETWEEN 1 AND 921600);
-- Tope de tamaño del formulario guardado (texto), para que un enlace filtrado no llene la base.
ALTER TABLE "ClinicOnboarding"
  ADD CONSTRAINT "ClinicOnboarding_data_size" CHECK (octet_length("data"::text) <= 262144);
