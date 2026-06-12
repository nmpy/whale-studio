-- Phase: OA に利用区分 (個人/法人) を追加。
-- Phase2 で追加済みの enum "BusinessUsageType" を再利用。既存 OA は default 'personal' で個人扱い。
-- 法人招待リンク (business_invite_links.usage_type) とは別物（自動連携なし）。
ALTER TABLE "oas" ADD COLUMN "usage_type" "BusinessUsageType" NOT NULL DEFAULT 'personal';
