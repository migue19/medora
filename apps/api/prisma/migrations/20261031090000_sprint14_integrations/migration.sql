-- CreateEnum
CREATE TYPE "CalendarProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'ERROR', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "prefix" VARCHAR(16) NOT NULL,
    "keyHash" CHAR(64) NOT NULL,
    "scopes" TEXT[],
    "createdById" UUID NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "secret" VARCHAR(80) NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseCode" INTEGER,
    "lastError" VARCHAR(300),
    "deliveredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "provider" "CalendarProvider" NOT NULL,
    "accountEmail" VARCHAR(254) NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "channelId" VARCHAR(255),
    "channelResourceId" VARCHAR(255),
    "channelToken" VARCHAR(80),
    "channelExpiresAt" TIMESTAMPTZ(3),
    "pushAppointments" BOOLEAN NOT NULL DEFAULT true,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncAt" TIMESTAMPTZ(3),
    "lastError" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalBusy" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "externalId" VARCHAR(1024) NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ExternalBusy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentCalendarEvent" (
    "appointmentId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "externalEventId" VARCHAR(1024) NOT NULL,

    CONSTRAINT "AppointmentCalendarEvent_pkey" PRIMARY KEY ("appointmentId","connectionId")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "endpoint" VARCHAR(1000) NOT NULL,
    "p256dh" VARCHAR(200) NOT NULL,
    "auth" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_clinicId_idx" ON "ApiKey"("clinicId");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_clinicId_idx" ON "WebhookEndpoint"("clinicId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_endpointId_eventId_key" ON "WebhookDelivery"("endpointId", "eventId");

-- CreateIndex
CREATE INDEX "CalendarConnection_channelId_idx" ON "CalendarConnection"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_doctorId_provider_key" ON "CalendarConnection"("doctorId", "provider");

-- CreateIndex
CREATE INDEX "ExternalBusy_doctorId_startsAt_idx" ON "ExternalBusy"("doctorId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalBusy_connectionId_externalId_key" ON "ExternalBusy"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "AppointmentCalendarEvent_connectionId_externalEventId_idx" ON "AppointmentCalendarEvent"("connectionId", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_membershipId_idx" ON "PushSubscription"("membershipId");

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalBusy" ADD CONSTRAINT "ExternalBusy_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CalendarConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentCalendarEvent" ADD CONSTRAINT "AppointmentCalendarEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CalendarConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Citas creadas por la API pública.
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_channel";
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_channel" CHECK ("channel" IS NULL OR "channel" IN ('web', 'widget', 'google', 'instagram', 'directorio', 'api'));

ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_https" CHECK (url ~ '^https://');
ALTER TABLE "ExternalBusy" ADD CONSTRAINT "ExternalBusy_range" CHECK ("endsAt" > "startsAt");

-- Cada evento de una cita (alta, cambio, cancelación, resultado, pago) sale hacia fuera: webhooks y
-- calendarios de los médicos. Se encola en la misma transacción que el evento, para cualquier camino del código.
CREATE OR REPLACE FUNCTION appointment_outbound() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "Job" (id, type, payload, "dedupeKey", "runAt")
  VALUES (gen_random_uuid(), 'appointment.outbound', jsonb_build_object('eventId', NEW.id), 'outbound:' || NEW.id, now())
  ON CONFLICT ("dedupeKey") DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER "AppointmentEvent_outbound" AFTER INSERT ON "AppointmentEvent" FOR EACH ROW EXECUTE FUNCTION appointment_outbound();

