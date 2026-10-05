-- CreateEnum
CREATE TYPE "SectorKind" AS ENUM ('REQUESTER', 'SERVICE', 'BOTH');

-- CreateEnum
CREATE TYPE "DelegationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DelegationEventType" AS ENUM ('CREATED', 'ACCEPTED', 'PROGRESS_UPDATED', 'COMPLETED', 'RETURNED', 'CANCELLED', 'COMMENTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'DELEGATION_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'DELEGATION_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE 'DELEGATION_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'DELEGATION_RETURNED';

-- AlterTable
ALTER TABLE "maintenance_requests" ADD COLUMN     "sector_id" TEXT,
ADD COLUMN     "service_sector_id" TEXT;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "sector_id" TEXT;

-- AlterTable
ALTER TABLE "requests" ADD COLUMN     "sector_id" TEXT,
ADD COLUMN     "service_sector_id" TEXT,
ADD COLUMN     "spawned_from_delegation_id" TEXT;

-- CreateTable
CREATE TABLE "sectors" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SectorKind" NOT NULL DEFAULT 'REQUESTER',
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delegations" (
    "id" TEXT NOT NULL,
    "from_sector_id" TEXT NOT NULL,
    "to_sector_id" TEXT NOT NULL,
    "status" "DelegationStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "report" TEXT,
    "requested_by_id" TEXT NOT NULL,
    "accepted_by_id" TEXT,
    "accepted_at" TIMESTAMP(3),
    "completed_by_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "request_id" TEXT,
    "maintenance_request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delegation_events" (
    "id" TEXT NOT NULL,
    "delegation_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "type" "DelegationEventType" NOT NULL,
    "from_status" "DelegationStatus",
    "to_status" "DelegationStatus",
    "comment" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delegation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "request_id" TEXT,
    "maintenance_request_id" TEXT,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sectors_code_key" ON "sectors"("code");

-- CreateIndex
CREATE INDEX "sectors_kind_idx" ON "sectors"("kind");

-- CreateIndex
CREATE INDEX "sectors_active_idx" ON "sectors"("active");

-- CreateIndex
CREATE INDEX "delegations_to_sector_id_status_idx" ON "delegations"("to_sector_id", "status");

-- CreateIndex
CREATE INDEX "delegations_from_sector_id_status_idx" ON "delegations"("from_sector_id", "status");

-- CreateIndex
CREATE INDEX "delegations_request_id_idx" ON "delegations"("request_id");

-- CreateIndex
CREATE INDEX "delegations_maintenance_request_id_idx" ON "delegations"("maintenance_request_id");

-- CreateIndex
CREATE INDEX "delegation_events_delegation_id_created_at_idx" ON "delegation_events"("delegation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storage_key_key" ON "attachments"("storage_key");

-- CreateIndex
CREATE INDEX "attachments_request_id_idx" ON "attachments"("request_id");

-- CreateIndex
CREATE INDEX "attachments_maintenance_request_id_idx" ON "attachments"("maintenance_request_id");

-- CreateIndex
CREATE INDEX "maintenance_requests_sector_id_idx" ON "maintenance_requests"("sector_id");

-- CreateIndex
CREATE INDEX "maintenance_requests_service_sector_id_idx" ON "maintenance_requests"("service_sector_id");

-- CreateIndex
CREATE INDEX "memberships_sector_id_idx" ON "memberships"("sector_id");

-- CreateIndex
CREATE UNIQUE INDEX "requests_spawned_from_delegation_id_key" ON "requests"("spawned_from_delegation_id");

-- CreateIndex
CREATE INDEX "requests_sector_id_idx" ON "requests"("sector_id");

-- CreateIndex
CREATE INDEX "requests_service_sector_id_idx" ON "requests"("service_sector_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_service_sector_id_fkey" FOREIGN KEY ("service_sector_id") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_spawned_from_delegation_id_fkey" FOREIGN KEY ("spawned_from_delegation_id") REFERENCES "delegations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_service_sector_id_fkey" FOREIGN KEY ("service_sector_id") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_from_sector_id_fkey" FOREIGN KEY ("from_sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_to_sector_id_fkey" FOREIGN KEY ("to_sector_id") REFERENCES "sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_accepted_by_id_fkey" FOREIGN KEY ("accepted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_maintenance_request_id_fkey" FOREIGN KEY ("maintenance_request_id") REFERENCES "maintenance_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation_events" ADD CONSTRAINT "delegation_events_delegation_id_fkey" FOREIGN KEY ("delegation_id") REFERENCES "delegations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation_events" ADD CONSTRAINT "delegation_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_maintenance_request_id_fkey" FOREIGN KEY ("maintenance_request_id") REFERENCES "maintenance_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
