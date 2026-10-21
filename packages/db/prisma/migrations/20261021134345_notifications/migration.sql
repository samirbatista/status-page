-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('email', 'telegram', 'slack', 'discord', 'teams', 'google_chat', 'whatsapp', 'webhook');

-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('incident_created', 'incident_updated', 'incident_resolved', 'maintenance_scheduled', 'maintenance_reminder', 'maintenance_started', 'maintenance_updated', 'maintenance_completed');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "SubscriberStatus" AS ENUM ('pending', 'active', 'unsubscribed');

-- AlterTable
ALTER TABLE "maintenances" ADD COLUMN     "reminder_sent_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "notification_channels" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config_enc" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY['incident', 'maintenance']::TEXT[],
    "locale" TEXT NOT NULL DEFAULT 'pt-BR',
    "last_test_at" TIMESTAMPTZ(3),
    "last_test_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "event" "NotificationEventType" NOT NULL,
    "locale" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_events" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "type" "NotificationEventType" NOT NULL,
    "incident_id" UUID,
    "maintenance_id" UUID,
    "component_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fanned_out_at" TIMESTAMPTZ(3),

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "event_id" UUID,
    "channel_id" UUID,
    "subscriber_id" UUID,
    "kind" "NotificationKind" NOT NULL,
    "target" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscribers" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "target_enc" TEXT,
    "target_hash" TEXT,
    "target_display" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'pt-BR',
    "all_components" BOOLEAN NOT NULL DEFAULT true,
    "event_types" TEXT[] DEFAULT ARRAY['incident', 'maintenance']::TEXT[],
    "status" "SubscriberStatus" NOT NULL DEFAULT 'pending',
    "source" TEXT NOT NULL DEFAULT 'form',
    "manage_token_enc" TEXT NOT NULL,
    "manage_token_hash" TEXT NOT NULL,
    "link_token_hash" TEXT,
    "link_expires_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "unsubscribed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriber_components" (
    "subscriber_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,

    CONSTRAINT "subscriber_components_pkey" PRIMARY KEY ("subscriber_id","component_id")
);

-- CreateTable
CREATE TABLE "verification_codes" (
    "id" UUID NOT NULL,
    "subscriber_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "subscriber_id" UUID,
    "target_hash" TEXT,
    "action" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_channels_page_id_idx" ON "notification_channels"("page_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_page_id_channel_event_locale_key" ON "notification_templates"("page_id", "channel", "event", "locale");

-- CreateIndex
CREATE INDEX "notification_events_fanned_out_at_created_at_idx" ON "notification_events"("fanned_out_at", "created_at");

-- CreateIndex
CREATE INDEX "notification_events_page_id_created_at_idx" ON "notification_events"("page_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_page_id_created_at_idx" ON "notification_deliveries"("page_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_event_id_channel_id_key" ON "notification_deliveries"("event_id", "channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_event_id_subscriber_id_key" ON "notification_deliveries"("event_id", "subscriber_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_manage_token_hash_key" ON "subscribers"("manage_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_link_token_hash_key" ON "subscribers"("link_token_hash");

-- CreateIndex
CREATE INDEX "subscribers_page_id_status_idx" ON "subscribers"("page_id", "status");

-- CreateIndex
CREATE INDEX "subscribers_status_created_at_idx" ON "subscribers"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_page_id_kind_target_hash_key" ON "subscribers"("page_id", "kind", "target_hash");

-- CreateIndex
CREATE INDEX "subscriber_components_component_id_idx" ON "subscriber_components"("component_id");

-- CreateIndex
CREATE INDEX "verification_codes_subscriber_id_created_at_idx" ON "verification_codes"("subscriber_id", "created_at");

-- CreateIndex
CREATE INDEX "consent_records_page_id_created_at_idx" ON "consent_records"("page_id", "created_at");

-- CreateIndex
CREATE INDEX "consent_records_subscriber_id_idx" ON "consent_records"("subscriber_id");

-- AddForeignKey
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "notification_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "notification_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriber_components" ADD CONSTRAINT "subscriber_components_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriber_components" ADD CONSTRAINT "subscriber_components_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
