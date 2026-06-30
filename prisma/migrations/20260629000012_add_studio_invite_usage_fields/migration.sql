-- 統合招待(StudioInvite)に、招待アクション区分・メール・使用上限/使用回数を追加する。
-- 統合「招待URL発行」(個人/法人) の受け皿として StudioInvite を拡張する。Organization は新設しない。
--
-- 安全性:
--   - additive のみ(nullable カラム追加 + NOT NULL DEFAULT 付きカラム追加)。既存テーブル/データは保持。
--   - max_uses/used_count は DEFAULT 付きのため既存行は自動で 1 / 0 に埋まる(= 従来の単発消費を維持)。
--   - invite_action / email は nullable(既存行は NULL = 従来の単純付与)。
--   - IF NOT EXISTS で冪等。revokedAt は既存カラムを「無効化(disabledAt 相当)」として流用(リネームしない)。
--   - 本番適用は別途承認制(このコードを deploy する前に本番DBへ適用すること)。

ALTER TABLE "studio_invites" ADD COLUMN IF NOT EXISTS "invite_action" TEXT;
ALTER TABLE "studio_invites" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "studio_invites" ADD COLUMN IF NOT EXISTS "max_uses" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "studio_invites" ADD COLUMN IF NOT EXISTS "used_count" INTEGER NOT NULL DEFAULT 0;
