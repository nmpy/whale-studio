-- あいさつ送信前の「入力中…」演出の待機秒数（0〜8、0=演出なし）。PR-B1。
-- additive / idempotent。既存 works 行は DEFAULT 0 を得る。CHECK 制約は付けず API zod(0-8) で守る。
-- 本番適用は別途承認制（このコードを deploy する前に本番DBへ適用すること）。
ALTER TABLE "works"
  ADD COLUMN IF NOT EXISTS "welcome_loading_seconds" INTEGER NOT NULL DEFAULT 0;
