-- CreateEnum
CREATE TYPE "MonitorType" AS ENUM ('http', 'tcp', 'icmp', 'dns', 'ssl');

-- CreateEnum
CREATE TYPE "AutomationMode" AS ENUM ('auto', 'suggest');

-- CreateEnum
CREATE TYPE "MonitorState" AS ENUM ('unknown', 'up', 'down');

-- CreateEnum
CREATE TYPE "InboundKind" AS ENUM ('alertmanager', 'grafana', 'zabbix', 'uptime_kuma', 'generic');

-- CreateEnum
CREATE TYPE "AlertState" AS ENUM ('open', 'accepted', 'dismissed', 'resolved');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEventType" ADD VALUE 'component_status_changed';
ALTER TYPE "NotificationEventType" ADD VALUE 'postmortem_published';

-- CreateTable
CREATE TABLE "monitors" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "component_id" UUID,
    "name" TEXT NOT NULL,
    "type" "MonitorType" NOT NULL,
    "target" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "headers_enc" TEXT,
    "interval_seconds" INTEGER NOT NULL DEFAULT 60,
    "timeout_ms" INTEGER NOT NULL DEFAULT 10000,
    "failure_threshold" INTEGER NOT NULL DEFAULT 3,
    "recovery_threshold" INTEGER NOT NULL DEFAULT 2,
    "mode" "AutomationMode" NOT NULL DEFAULT 'auto',
    "failure_status" "ComponentStatus" NOT NULL DEFAULT 'major_outage',
    "template_id" UUID,
    "public_metrics" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "state" "MonitorState" NOT NULL DEFAULT 'unknown',
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "consecutive_successes" INTEGER NOT NULL DEFAULT 0,
    "last_check_at" TIMESTAMPTZ(3),
    "last_latency_ms" INTEGER,
    "last_error" TEXT,
    "next_check_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_check_results" (
    "id" UUID NOT NULL,
    "monitor_id" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "latency_ms" INTEGER,
    "error" TEXT,

    CONSTRAINT "monitor_check_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_sources" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "kind" "InboundKind" NOT NULL,
    "name" TEXT NOT NULL,
    "token_enc" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "hmac_secret_enc" TEXT,
    "mode" "AutomationMode" NOT NULL DEFAULT 'suggest',
    "template_id" UUID,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_received_at" TIMESTAMPTZ(3),
    "last_result" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inbound_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_rules" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "match_field" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "component_id" UUID NOT NULL,
    "status" "ComponentStatus" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_states" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "page_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "applied_status" "ComponentStatus" NOT NULL,
    "previous_status" "ComponentStatus" NOT NULL,
    "incident_id" UUID,
    "title" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'failure',
    "suggested_status" "ComponentStatus" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "source" TEXT NOT NULL,
    "template_id" UUID,
    "state" "AlertState" NOT NULL DEFAULT 'open',
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handled_at" TIMESTAMPTZ(3),
    "handled_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "postmortems" (
    "incident_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "postmortems_pkey" PRIMARY KEY ("incident_id")
);

-- CreateIndex
CREATE INDEX "monitors_page_id_idx" ON "monitors"("page_id");

-- CreateIndex
CREATE INDEX "monitors_enabled_next_check_at_idx" ON "monitors"("enabled", "next_check_at");

-- CreateIndex
CREATE INDEX "monitor_check_results_monitor_id_checked_at_idx" ON "monitor_check_results"("monitor_id", "checked_at");

-- CreateIndex
CREATE INDEX "monitor_check_results_checked_at_idx" ON "monitor_check_results"("checked_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_sources_token_hash_key" ON "inbound_sources"("token_hash");

-- CreateIndex
CREATE INDEX "inbound_sources_page_id_idx" ON "inbound_sources"("page_id");

-- CreateIndex
CREATE INDEX "inbound_rules_source_id_position_idx" ON "inbound_rules"("source_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "automation_states_key_key" ON "automation_states"("key");

-- CreateIndex
CREATE INDEX "automation_states_component_id_idx" ON "automation_states"("component_id");

-- CreateIndex
CREATE INDEX "alerts_page_id_state_idx" ON "alerts"("page_id", "state");

-- CreateIndex
CREATE INDEX "alerts_key_state_idx" ON "alerts"("key", "state");

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "components"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "incident_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_check_results" ADD CONSTRAINT "monitor_check_results_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_sources" ADD CONSTRAINT "inbound_sources_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_sources" ADD CONSTRAINT "inbound_sources_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "incident_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_rules" ADD CONSTRAINT "inbound_rules_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "inbound_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_rules" ADD CONSTRAINT "inbound_rules_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_states" ADD CONSTRAINT "automation_states_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_states" ADD CONSTRAINT "automation_states_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postmortems" ADD CONSTRAINT "postmortems_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
