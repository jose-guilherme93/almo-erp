-- CreateEnum
CREATE TYPE "MaintenanceCategory" AS ENUM ('ELECTRICAL', 'PLUMBING', 'HVAC', 'FURNITURE', 'CIVIL', 'IT', 'EQUIPMENT', 'CLEANING', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'IN_PROGRESS', 'WAITING_PARTS', 'DONE', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MaintenanceEventType" AS ENUM ('CREATED', 'CLAIMED', 'PRIORITY_SET', 'ASSIGNED', 'PROGRESS_UPDATED', 'WAITING_PARTS', 'COMPLETED', 'REJECTED', 'CANCELLED', 'COMMENTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'MAINTENANCE_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'MAINTENANCE_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'MAINTENANCE_PRIORITY_SET';
ALTER TYPE "NotificationType" ADD VALUE 'MAINTENANCE_DONE';

-- CreateTable
CREATE TABLE "maintenance_requests" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "category" "MaintenanceCategory" NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "RequestPriority",
    "location" TEXT NOT NULL,
    "asset_tag" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "responsible_id" TEXT,
    "claimed_by_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "assigned_to_id" TEXT,
    "assigned_at" TIMESTAMP(3),
    "resolution" TEXT,
    "completedAt" TIMESTAMP(3),
    "resolution_hours" INTEGER,
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_events" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "type" "MaintenanceEventType" NOT NULL,
    "from_status" "MaintenanceStatus",
    "to_status" "MaintenanceStatus",
    "comment" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_requests_branch_id_status_idx" ON "maintenance_requests"("branch_id", "status");

-- CreateIndex
CREATE INDEX "maintenance_requests_requester_id_status_idx" ON "maintenance_requests"("requester_id", "status");

-- CreateIndex
CREATE INDEX "maintenance_requests_assigned_to_id_status_idx" ON "maintenance_requests"("assigned_to_id", "status");

-- CreateIndex
CREATE INDEX "maintenance_requests_status_priority_created_at_idx" ON "maintenance_requests"("status", "priority", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_requests_branch_id_number_key" ON "maintenance_requests"("branch_id", "number");

-- CreateIndex
CREATE INDEX "maintenance_events_request_id_created_at_idx" ON "maintenance_events"("request_id", "created_at");

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_claimed_by_id_fkey" FOREIGN KEY ("claimed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_events" ADD CONSTRAINT "maintenance_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "maintenance_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_events" ADD CONSTRAINT "maintenance_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
