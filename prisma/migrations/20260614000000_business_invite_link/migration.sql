-- Phase2: 法人招待リンク (business invite link)
-- platform admin が plan / role / usageType を事前指定した法人申込 URL を発行する。
-- 平文 token は保存せず sha256 hex を token_hash として保存。URL には token のみを含める。
-- 申込フォーム送信時のみ used_at をセットし BusinessInviteApplication を作成する (= 再申請不可)。
-- 有効性は (expires_at IS NULL OR expires_at > now()) AND used_at IS NULL AND revoked_at IS NULL で判定。

-- CreateEnum
CREATE TYPE "BusinessUsageType" AS ENUM ('personal', 'business');

-- CreateTable: business_invite_links
CREATE TABLE "business_invite_links" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "usage_type" "BusinessUsageType" NOT NULL DEFAULT 'business',
    "plan_tier" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "note" TEXT,
    "expires_at" TIMESTAMP(3),
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_invite_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable: business_invite_applications
CREATE TABLE "business_invite_applications" (
    "id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "line_official_account_name" TEXT,
    "message" TEXT,
    "snapshot_plan_tier" TEXT NOT NULL,
    "snapshot_role" "MemberRole" NOT NULL,
    "snapshot_usage_type" "BusinessUsageType" NOT NULL,
    "submitted_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_invite_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_invite_links_token_hash_key" ON "business_invite_links"("token_hash");
CREATE INDEX "business_invite_links_created_by_user_id_created_at_idx" ON "business_invite_links"("created_by_user_id", "created_at");
CREATE INDEX "business_invite_links_used_at_revoked_at_idx" ON "business_invite_links"("used_at", "revoked_at");
CREATE UNIQUE INDEX "business_invite_applications_link_id_key" ON "business_invite_applications"("link_id");

-- AddForeignKey
ALTER TABLE "business_invite_applications" ADD CONSTRAINT "business_invite_applications_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "business_invite_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
