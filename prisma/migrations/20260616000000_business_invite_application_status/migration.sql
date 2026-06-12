-- 法人申込に運営対応ステータスを追加（承認/却下/対応済み管理）。
-- 承認はステータス変更のみ。自動 OA 作成 / 権限付与 / 課金は行わない。
-- 既存申込は status='pending'（未対応）扱い。非破壊（ADD COLUMN + DEFAULT / nullable）。

-- CreateEnum
CREATE TYPE "BusinessInviteApplicationStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "business_invite_applications" ADD COLUMN "status" "BusinessInviteApplicationStatus" NOT NULL DEFAULT 'pending';
ALTER TABLE "business_invite_applications" ADD COLUMN "reviewed_at" TIMESTAMP(3);
ALTER TABLE "business_invite_applications" ADD COLUMN "reviewed_by_user_id" TEXT;
ALTER TABLE "business_invite_applications" ADD COLUMN "review_note" TEXT;
