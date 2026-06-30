-- Subscription に手動上書き（manual override）専用カラムを追加する（PR3）。
-- 運営が OA 単位で付与する手動プランを、Stripe 由来フィールド（external_id/status/
-- current_period_*/plan_id）とは完全に分離して保持する。Stripe webhook はここを一切触らない。
--
-- 安全性:
--   - additive のみ（すべて nullable カラム追加・FK なし）。既存テーブル/データは保持。
--   - nullable のため PostgreSQL ではテーブル書き換えなし（即時・実質ロックなし）。
--   - 既存行は全カラム NULL = 従来のプラン解決と完全一致（manual > beta/trial > Stripe > basic）。
--   - manual_plan_tier は PlanTier 文字列（basic|standard|plus|pro|delegated）。不正値は読み取り時に無効扱い。
--   - IF NOT EXISTS で冪等。本番適用は別途承認制（このコードを deploy する前に本番DBへ適用すること）。

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "manual_plan_tier" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "manual_source" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "manual_starts_at" TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "manual_ends_at" TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "manual_disabled_at" TIMESTAMP(3);
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "manual_note" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "manual_created_by_user_id" TEXT;
