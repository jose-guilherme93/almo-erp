-- AlterEnum
ALTER TYPE "AssetEventType" ADD VALUE 'TRANSFERRED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ASSET_TRANSFERRED';

-- AlterTable
ALTER TABLE "asset_events" ADD COLUMN     "from_branch_id" TEXT,
ADD COLUMN     "to_branch_id" TEXT;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
