-- あいさつメッセージの複数件・text/image 対応（PR-G2-A）
-- additive / idempotent。既存 works 行は DEFAULT '[]' を得る。既存 welcome_message は残す。
-- 本番適用は別途承認制（このコードを deploy する前に本番DBへ適用すること）。
ALTER TABLE "works"
  ADD COLUMN IF NOT EXISTS "welcome_messages_json" JSONB NOT NULL DEFAULT '[]';
