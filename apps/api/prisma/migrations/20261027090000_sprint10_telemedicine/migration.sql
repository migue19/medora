-- CreateEnum
CREATE TYPE "AppointmentModality" AS ENUM ('IN_PERSON', 'VIDEO');


-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "doctorJoinedAt" TIMESTAMPTZ(3),
ADD COLUMN     "modality" "AppointmentModality" NOT NULL DEFAULT 'IN_PERSON',
ADD COLUMN     "patientJoinedAt" TIMESTAMPTZ(3),
ADD COLUMN     "patientSeenAt" TIMESTAMPTZ(3),
ADD COLUMN     "videoConsentAt" TIMESTAMPTZ(3),
ADD COLUMN     "videoConsentVersion" VARCHAR(20);

-- Una videoconsulta aceptada siempre guarda la versión del consentimiento.
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_video_consent" CHECK (("videoConsentAt" IS NULL) = ("videoConsentVersion" IS NULL));
