-- AlterTable
ALTER TABLE "live_participants" ADD COLUMN "auth_user_id" TEXT;
ALTER TABLE "live_participants" ADD COLUMN "email" TEXT;

-- CreateIndex
CREATE INDEX "live_participants_oa_id_auth_user_id_idx" ON "live_participants"("oa_id", "auth_user_id");
