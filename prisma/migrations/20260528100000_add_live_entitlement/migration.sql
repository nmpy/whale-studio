-- CreateEnum
CREATE TYPE "LiveRole" AS ENUM ('live_player', 'live_admin', 'live_actor');

-- AlterTable
ALTER TABLE "workspace_members" ADD COLUMN "live_role" "LiveRole";

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN "live_role" "LiveRole";

-- CreateTable
CREATE TABLE "oa_entitlements" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "feature_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oa_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "oa_entitlements_oa_id_idx" ON "oa_entitlements"("oa_id");

-- CreateIndex
CREATE UNIQUE INDEX "oa_entitlements_oa_id_feature_key_key" ON "oa_entitlements"("oa_id", "feature_key");

-- AddForeignKey
ALTER TABLE "oa_entitlements" ADD CONSTRAINT "oa_entitlements_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
