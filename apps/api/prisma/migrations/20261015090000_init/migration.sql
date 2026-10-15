-- CreateSchema

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'ADMIN', 'RECEPTION', 'DOCTOR');

-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('STAFF', 'PATIENT');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('ONLINE', 'STAFF');

-- CreateEnum
CREATE TYPE "ActorKind" AS ENUM ('STAFF', 'PATIENT');

-- CreateEnum
CREATE TYPE "AppointmentEventType" AS ENUM ('CREATED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "Clinic" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Mexico_City',
    "phone" VARCHAR(30),
    "address" VARCHAR(240),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "bookingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "minNoticeMinutes" INTEGER NOT NULL DEFAULT 60,
    "horizonDays" INTEGER NOT NULL DEFAULT 60,
    "patientCancelMinMinutes" INTEGER NOT NULL DEFAULT 120,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Clinic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "role" "StaffRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientAccount" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PatientAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" UUID NOT NULL,
    "kind" "SessionKind" NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "membershipId" UUID,
    "patientAccountId" UUID,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicPatient" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "patientAccountId" UUID,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "email" VARCHAR(254),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClinicPatient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Doctor" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "membershipId" UUID,
    "displayName" VARCHAR(120) NOT NULL,
    "specialty" VARCHAR(120) NOT NULL,
    "licenseNumber" VARCHAR(30),
    "bio" VARCHAR(1000),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorService" (
    "doctorId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "clinicId" UUID NOT NULL,

    CONSTRAINT "DoctorService_pkey" PRIMARY KEY ("doctorId","serviceId")
);

-- CreateTable
CREATE TABLE "ScheduleRule" (
    "id" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "ScheduleRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeOff" (
    "id" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "clinicPatientId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "source" "AppointmentSource" NOT NULL,
    "serviceName" VARCHAR(120) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "patientNotes" VARCHAR(500),
    "requestKey" VARCHAR(120) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "cancelReason" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentEvent" (
    "id" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "type" "AppointmentEventType" NOT NULL,
    "actorKind" "ActorKind" NOT NULL,
    "actorId" UUID NOT NULL,
    "actorName" VARCHAR(120) NOT NULL,
    "reason" VARCHAR(200),
    "fromStartsAt" TIMESTAMPTZ(3),
    "toStartsAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Clinic_slug_key" ON "Clinic"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_clinicId_idx" ON "Membership"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_clinicId_key" ON "Membership"("userId", "clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_id_clinicId_key" ON "Membership"("id", "clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientAccount_email_key" ON "PatientAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_familyId_idx" ON "RefreshSession"("familyId");

-- CreateIndex
CREATE INDEX "RefreshSession_membershipId_idx" ON "RefreshSession"("membershipId");

-- CreateIndex
CREATE INDEX "RefreshSession_patientAccountId_idx" ON "RefreshSession"("patientAccountId");

-- CreateIndex
CREATE INDEX "ClinicPatient_clinicId_name_idx" ON "ClinicPatient"("clinicId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicPatient_clinicId_patientAccountId_key" ON "ClinicPatient"("clinicId", "patientAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicPatient_id_clinicId_key" ON "ClinicPatient"("id", "clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_membershipId_key" ON "Doctor"("membershipId");

-- CreateIndex
CREATE INDEX "Doctor_clinicId_idx" ON "Doctor"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_id_clinicId_key" ON "Doctor"("id", "clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_membershipId_clinicId_key" ON "Doctor"("membershipId", "clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Service_clinicId_name_key" ON "Service"("clinicId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Service_id_clinicId_key" ON "Service"("id", "clinicId");

-- CreateIndex
CREATE INDEX "ScheduleRule_doctorId_idx" ON "ScheduleRule"("doctorId");

-- CreateIndex
CREATE INDEX "TimeOff_doctorId_startsAt_idx" ON "TimeOff"("doctorId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_requestKey_key" ON "Appointment"("requestKey");

-- CreateIndex
CREATE INDEX "Appointment_clinicId_startsAt_idx" ON "Appointment"("clinicId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_doctorId_startsAt_idx" ON "Appointment"("doctorId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_clinicPatientId_startsAt_idx" ON "Appointment"("clinicPatientId", "startsAt");

-- CreateIndex
CREATE INDEX "AppointmentEvent_appointmentId_idx" ON "AppointmentEvent"("appointmentId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_patientAccountId_fkey" FOREIGN KEY ("patientAccountId") REFERENCES "PatientAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicPatient" ADD CONSTRAINT "ClinicPatient_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicPatient" ADD CONSTRAINT "ClinicPatient_patientAccountId_fkey" FOREIGN KEY ("patientAccountId") REFERENCES "PatientAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_membershipId_clinicId_fkey" FOREIGN KEY ("membershipId", "clinicId") REFERENCES "Membership"("id", "clinicId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorService" ADD CONSTRAINT "DoctorService_doctorId_clinicId_fkey" FOREIGN KEY ("doctorId", "clinicId") REFERENCES "Doctor"("id", "clinicId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorService" ADD CONSTRAINT "DoctorService_serviceId_clinicId_fkey" FOREIGN KEY ("serviceId", "clinicId") REFERENCES "Service"("id", "clinicId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRule" ADD CONSTRAINT "ScheduleRule_doctorId_clinicId_fkey" FOREIGN KEY ("doctorId", "clinicId") REFERENCES "Doctor"("id", "clinicId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_doctorId_clinicId_fkey" FOREIGN KEY ("doctorId", "clinicId") REFERENCES "Doctor"("id", "clinicId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorId_clinicId_fkey" FOREIGN KEY ("doctorId", "clinicId") REFERENCES "Doctor"("id", "clinicId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_serviceId_clinicId_fkey" FOREIGN KEY ("serviceId", "clinicId") REFERENCES "Service"("id", "clinicId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clinicPatientId_clinicId_fkey" FOREIGN KEY ("clinicPatientId", "clinicId") REFERENCES "ClinicPatient"("id", "clinicId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentEvent" ADD CONSTRAINT "AppointmentEvent_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Reglas de integridad adicionales (no expresables en Prisma)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Clinic"
  ADD CONSTRAINT "Clinic_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") BETWEEN 3 AND 60),
  ADD CONSTRAINT "Clinic_minNotice_range" CHECK ("minNoticeMinutes" BETWEEN 0 AND 10080),
  ADD CONSTRAINT "Clinic_horizon_range" CHECK ("horizonDays" BETWEEN 1 AND 365),
  ADD CONSTRAINT "Clinic_patientCancel_range" CHECK ("patientCancelMinMinutes" BETWEEN 0 AND 10080);

ALTER TABLE "RefreshSession"
  ADD CONSTRAINT "RefreshSession_owner" CHECK (
    ("kind" = 'STAFF' AND "membershipId" IS NOT NULL AND "patientAccountId" IS NULL) OR
    ("kind" = 'PATIENT' AND "patientAccountId" IS NOT NULL AND "membershipId" IS NULL)
  );

ALTER TABLE "Service"
  ADD CONSTRAINT "Service_duration_range" CHECK ("durationMinutes" BETWEEN 5 AND 480 AND "durationMinutes" % 5 = 0),
  ADD CONSTRAINT "Service_price_range" CHECK ("priceCents" BETWEEN 0 AND 99999999);

ALTER TABLE "ScheduleRule"
  ADD CONSTRAINT "ScheduleRule_weekday_range" CHECK ("weekday" BETWEEN 1 AND 7),
  ADD CONSTRAINT "ScheduleRule_minutes_range" CHECK (
    "startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute"
    AND "startMinute" % 5 = 0 AND "endMinute" % 5 = 0
  ),
  ADD CONSTRAINT "ScheduleRule_no_overlap" EXCLUDE USING gist (
    "doctorId" WITH =, "weekday" WITH =, int4range("startMinute", "endMinute") WITH &&
  );

ALTER TABLE "TimeOff"
  ADD CONSTRAINT "TimeOff_range" CHECK ("endsAt" > "startsAt");

-- Un médico no puede tener dos citas vigentes que se traslapen.
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_range" CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "Appointment_duration_range" CHECK ("durationMinutes" BETWEEN 5 AND 480),
  ADD CONSTRAINT "Appointment_price_range" CHECK ("priceCents" BETWEEN 0 AND 99999999),
  ADD CONSTRAINT "Appointment_cancel_reason" CHECK ("status" <> 'CANCELLED' OR "cancelReason" IS NOT NULL),
  ADD CONSTRAINT "Appointment_no_double_booking" EXCLUDE USING gist (
    "doctorId" WITH =, tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("status" <> 'CANCELLED');
