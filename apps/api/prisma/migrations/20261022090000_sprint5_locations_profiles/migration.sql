-- CreateEnum
CREATE TYPE "VisitType" AS ENUM ('ANY', 'FIRST', 'FOLLOW_UP');

-- DropForeignKey
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_followUp_fkey";

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "locationId" UUID,
ADD COLUMN     "roomId" UUID;

-- AlterTable
ALTER TABLE "Doctor" ADD COLUMN     "certifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "conditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "education" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "insurers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ScheduleRule" ADD COLUMN     "locationId" UUID,
ADD COLUMN     "roomId" UUID;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "visitType" "VisitType" NOT NULL DEFAULT 'ANY';

-- CreateTable
CREATE TABLE "Location" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "address" VARCHAR(240),
    "phone" VARCHAR(30),
    "mapUrl" VARCHAR(500),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationHours" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "LocationHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorPhoto" (
    "doctorId" UUID NOT NULL,
    "mimeType" VARCHAR(20) NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DoctorPhoto_pkey" PRIMARY KEY ("doctorId")
);

-- CreateTable
CREATE TABLE "ServicePrice" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "doctorId" UUID,
    "locationId" UUID,
    "priceCents" INTEGER NOT NULL,

    CONSTRAINT "ServicePrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Location_clinicId_idx" ON "Location"("clinicId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_clinicId_name_key" ON "Location"("clinicId", "name");

-- CreateIndex
CREATE INDEX "LocationHours_locationId_idx" ON "LocationHours"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_locationId_name_key" ON "Room"("locationId", "name");

-- CreateIndex
CREATE INDEX "ServicePrice_serviceId_idx" ON "ServicePrice"("serviceId");

-- CreateIndex
CREATE INDEX "ScheduleRule_roomId_idx" ON "ScheduleRule"("roomId");

-- AddForeignKey
ALTER TABLE "ScheduleRule" ADD CONSTRAINT "ScheduleRule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRule" ADD CONSTRAINT "ScheduleRule_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationHours" ADD CONSTRAINT "LocationHours_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorPhoto" ADD CONSTRAINT "DoctorPhoto_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePrice" ADD CONSTRAINT "ServicePrice_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePrice" ADD CONSTRAINT "ServicePrice_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Datos existentes: una «Sede principal» por clínica con su dirección y teléfono.
INSERT INTO "Location" (id, "clinicId", name, address, phone, "updatedAt")
SELECT gen_random_uuid(), c.id, 'Sede principal', c.address, c.phone, now() FROM "Clinic" c;
UPDATE "ScheduleRule" r SET "locationId" = l.id FROM "Location" l WHERE l."clinicId" = r."clinicId";
UPDATE "Appointment" a SET "locationId" = l.id FROM "Location" l WHERE l."clinicId" = a."clinicId";
ALTER TABLE "ScheduleRule" ALTER COLUMN "locationId" SET NOT NULL;
ALTER TABLE "Appointment" ALTER COLUMN "locationId" SET NOT NULL;

-- Restricciones de negocio (Sprint 5)
ALTER TABLE "Location"
  ADD CONSTRAINT "Location_mapUrl" CHECK ("mapUrl" IS NULL OR "mapUrl" ~ '^https://');

ALTER TABLE "LocationHours"
  ADD CONSTRAINT "LocationHours_weekday_range" CHECK ("weekday" BETWEEN 1 AND 7),
  ADD CONSTRAINT "LocationHours_minutes_range" CHECK (
    "startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute"
    AND "startMinute" % 5 = 0 AND "endMinute" % 5 = 0
  ),
  ADD CONSTRAINT "LocationHours_no_overlap" EXCLUDE USING gist (
    "locationId" WITH =, "weekday" WITH =, int4range("startMinute", "endMinute") WITH &&
  );

-- Un consultorio no puede estar asignado a dos bloques de horario traslapados (de cualquier médico).
ALTER TABLE "ScheduleRule"
  ADD CONSTRAINT "ScheduleRule_room_no_overlap" EXCLUDE USING gist (
    "roomId" WITH =, "weekday" WITH =, int4range("startMinute", "endMinute") WITH &&
  ) WHERE ("roomId" IS NOT NULL);

-- Un consultorio no puede tener dos citas vigentes que se traslapen.
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_room_no_double_booking" EXCLUDE USING gist (
    "roomId" WITH =, tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("status" <> 'CANCELLED' AND "roomId" IS NOT NULL);

ALTER TABLE "DoctorPhoto"
  ADD CONSTRAINT "DoctorPhoto_type" CHECK ("mimeType" IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT "DoctorPhoto_size" CHECK (octet_length("data") BETWEEN 1 AND 921600);

ALTER TABLE "Doctor"
  ADD CONSTRAINT "Doctor_profile_lists" CHECK (
    cardinality("education") <= 20 AND cardinality("certifications") <= 20 AND cardinality("languages") <= 20
    AND cardinality("conditions") <= 40 AND cardinality("insurers") <= 40
  );

ALTER TABLE "ServicePrice"
  ADD CONSTRAINT "ServicePrice_price_range" CHECK ("priceCents" BETWEEN 0 AND 99999999),
  ADD CONSTRAINT "ServicePrice_scope" CHECK ("doctorId" IS NOT NULL OR "locationId" IS NOT NULL),
  ADD CONSTRAINT "ServicePrice_doctor_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id");

-- Un solo precio por combinación servicio / médico / sede.
CREATE UNIQUE INDEX "ServicePrice_scope_key" ON "ServicePrice" (
  "serviceId", COALESCE("doctorId", '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE("locationId", '00000000-0000-0000-0000-000000000000'::uuid)
);
