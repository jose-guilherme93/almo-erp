-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ERROR_REPORTED';

-- CreateTable
CREATE TABLE "error_logs" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "digest" TEXT,
    "route_path" TEXT NOT NULL,
    "route_type" TEXT NOT NULL,
    "method" TEXT,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" TEXT,
    "app_version" TEXT,
    "actor_id" TEXT,
    "branch_id" TEXT,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "error_logs_fingerprint_key" ON "error_logs"("fingerprint");

-- CreateIndex
CREATE INDEX "error_logs_resolved_at_last_seen_at_idx" ON "error_logs"("resolved_at", "last_seen_at");

-- CreateIndex
CREATE INDEX "error_logs_route_path_last_seen_at_idx" ON "error_logs"("route_path", "last_seen_at");

-- CreateIndex
CREATE INDEX "error_logs_digest_idx" ON "error_logs"("digest");

-- AddForeignKey
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
