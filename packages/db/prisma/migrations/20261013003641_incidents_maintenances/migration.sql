-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('investigating', 'identified', 'monitoring', 'resolved');

-- CreateEnum
CREATE TYPE "IncidentImpact" AS ENUM ('none', 'minor', 'major', 'critical');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('scheduled', 'in_progress', 'completed');

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL,
    "impact" "IncidentImpact" NOT NULL DEFAULT 'minor',
    "backfilled" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_updates" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "status" "IncidentStatus" NOT NULL,
    "body" TEXT NOT NULL,
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "display_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_update_components" (
    "update_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "status" "ComponentStatus" NOT NULL,

    CONSTRAINT "incident_update_components_pkey" PRIMARY KEY ("update_id","component_id")
);

-- CreateTable
CREATE TABLE "maintenances" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'scheduled',
    "scheduled_start" TIMESTAMPTZ(3) NOT NULL,
    "scheduled_end" TIMESTAMPTZ(3) NOT NULL,
    "auto_start" BOOLEAN NOT NULL DEFAULT true,
    "auto_complete" BOOLEAN NOT NULL DEFAULT true,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "maintenances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_updates" (
    "id" UUID NOT NULL,
    "maintenance_id" UUID NOT NULL,
    "status" "MaintenanceStatus" NOT NULL,
    "body" TEXT NOT NULL,
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_components" (
    "maintenance_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "previous_status" "ComponentStatus",

    CONSTRAINT "maintenance_components_pkey" PRIMARY KEY ("maintenance_id","component_id")
);

-- CreateTable
CREATE TABLE "incident_templates" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'investigating',
    "impact" "IncidentImpact" NOT NULL DEFAULT 'minor',
    "component_ids" UUID[],
    "component_status" "ComponentStatus",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "incident_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incidents_page_id_status_idx" ON "incidents"("page_id", "status");

-- CreateIndex
CREATE INDEX "incidents_page_id_started_at_idx" ON "incidents"("page_id", "started_at");

-- CreateIndex
CREATE INDEX "incident_updates_incident_id_display_at_idx" ON "incident_updates"("incident_id", "display_at");

-- CreateIndex
CREATE INDEX "incident_update_components_component_id_idx" ON "incident_update_components"("component_id");

-- CreateIndex
CREATE INDEX "maintenances_status_scheduled_start_idx" ON "maintenances"("status", "scheduled_start");

-- CreateIndex
CREATE INDEX "maintenances_page_id_scheduled_start_idx" ON "maintenances"("page_id", "scheduled_start");

-- CreateIndex
CREATE INDEX "maintenance_updates_maintenance_id_created_at_idx" ON "maintenance_updates"("maintenance_id", "created_at");

-- CreateIndex
CREATE INDEX "maintenance_components_component_id_idx" ON "maintenance_components"("component_id");

-- CreateIndex
CREATE UNIQUE INDEX "incident_templates_page_id_name_key" ON "incident_templates"("page_id", "name");

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_update_components" ADD CONSTRAINT "incident_update_components_update_id_fkey" FOREIGN KEY ("update_id") REFERENCES "incident_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_update_components" ADD CONSTRAINT "incident_update_components_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenances" ADD CONSTRAINT "maintenances_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_updates" ADD CONSTRAINT "maintenance_updates_maintenance_id_fkey" FOREIGN KEY ("maintenance_id") REFERENCES "maintenances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_updates" ADD CONSTRAINT "maintenance_updates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_components" ADD CONSTRAINT "maintenance_components_maintenance_id_fkey" FOREIGN KEY ("maintenance_id") REFERENCES "maintenances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_components" ADD CONSTRAINT "maintenance_components_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_templates" ADD CONSTRAINT "incident_templates_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
