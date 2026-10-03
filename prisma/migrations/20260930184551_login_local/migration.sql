-- AlterTable
ALTER TABLE "users" ADD COLUMN     "password_hash" TEXT;

-- CreateTable
CREATE TABLE "login_throttles" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "first_failed_at" TIMESTAMP(3),
    "locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_throttles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "login_throttles_email_key" ON "login_throttles"("email");

-- CreateIndex
CREATE INDEX "login_throttles_locked_until_idx" ON "login_throttles"("locked_until");
