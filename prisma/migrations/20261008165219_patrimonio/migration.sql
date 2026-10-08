-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('IN_STOCK', 'IN_USE', 'IN_MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssetEventType" AS ENUM ('CREATED', 'ASSIGNED', 'RETURNED', 'MAINTENANCE_STARTED', 'MAINTENANCE_DONE', 'RETIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ASSET_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'ASSET_RETURNED';

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "track_as_asset" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "stock_lines" ADD COLUMN     "serial_numbers" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "serial_number" TEXT,
    "branch_id" TEXT NOT NULL,
    "storage_location_id" TEXT,
    "custodian_user_id" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_STOCK',
    "acquired_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_events" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "type" "AssetEventType" NOT NULL,
    "from_status" "AssetStatus",
    "to_status" "AssetStatus",
    "from_custodian_id" TEXT,
    "to_custodian_id" TEXT,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "actor_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_tag_key" ON "assets"("tag");

-- CreateIndex
CREATE INDEX "assets_branch_id_status_idx" ON "assets"("branch_id", "status");

-- CreateIndex
CREATE INDEX "assets_item_id_idx" ON "assets"("item_id");

-- CreateIndex
CREATE INDEX "assets_custodian_user_id_idx" ON "assets"("custodian_user_id");

-- CreateIndex
CREATE INDEX "assets_serial_number_idx" ON "assets"("serial_number");

-- CreateIndex
CREATE INDEX "asset_events_asset_id_created_at_idx" ON "asset_events"("asset_id", "created_at");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_custodian_user_id_fkey" FOREIGN KEY ("custodian_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_from_custodian_id_fkey" FOREIGN KEY ("from_custodian_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_to_custodian_id_fkey" FOREIGN KEY ("to_custodian_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Imutabilidade: o histórico de rastreio do bem nunca é alterado nem apagado
-- diretamente. DELETE só passa quando vem do apagamento do bem inteiro
-- (cascade), o que a aplicação nunca faz — a trilha é a verdade.
CREATE OR REPLACE FUNCTION prevent_asset_event_mutation()
RETURNS trigger AS $$
BEGIN
  -- Dentro deste trigger o nível já é 1; um DELETE direto fica em 1 e é
  -- bloqueado. O cascade do bem inteiro passa pelo trigger de FK antes, então
  -- chega em nível 2 e é permitido.
  IF TG_OP = 'UPDATE' OR pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'asset_events é imutável (append-only)';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_events_immutable
BEFORE UPDATE OR DELETE ON "asset_events"
FOR EACH ROW EXECUTE FUNCTION prevent_asset_event_mutation();
