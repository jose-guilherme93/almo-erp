-- CreateEnum
CREATE TYPE "ReportExportFormat" AS ENUM ('CSV', 'PDF', 'DRIVE', 'PRINT');

-- CreateTable
CREATE TABLE "report_snapshots" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "report_label" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "period_from" TIMESTAMP(3) NOT NULL,
    "period_to" TIMESTAMP(3) NOT NULL,
    "branch_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "headers" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "row_count" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "generated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_exports" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "format" "ReportExportFormat" NOT NULL,
    "actor_id" TEXT NOT NULL,
    "destination" TEXT,
    "destination_url" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_snapshots_report_id_created_at_idx" ON "report_snapshots"("report_id", "created_at");

-- CreateIndex
CREATE INDEX "report_snapshots_generated_by_id_created_at_idx" ON "report_snapshots"("generated_by_id", "created_at");

-- CreateIndex
CREATE INDEX "report_exports_snapshot_id_created_at_idx" ON "report_exports"("snapshot_id", "created_at");

-- CreateIndex
CREATE INDEX "report_exports_actor_id_created_at_idx" ON "report_exports"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "report_snapshots" ADD CONSTRAINT "report_snapshots_generated_by_id_fkey" FOREIGN KEY ("generated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "report_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Imutabilidade: relatório consolidado é evidência, nunca rascunho.
CREATE OR REPLACE FUNCTION prevent_report_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'report_snapshots é imutável (append-only)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER report_snapshots_immutable
BEFORE UPDATE OR DELETE ON "report_snapshots"
FOR EACH ROW EXECUTE FUNCTION prevent_report_snapshot_mutation();
