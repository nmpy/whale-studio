-- 作品（works）に開始キーワード（start_keyword）を追加する。
-- 同じ OA に複数作品を公開する場合、ユーザーがこのキーワードを送信するとその作品が開始される。
--
-- 安全性:
--   - additive のみ（nullable カラム追加）。既存テーブル/データは変更しない。
--   - nullable のため PostgreSQL ではテーブル書き換えなし（即時・実質ロックなし）。
--   - IF NOT EXISTS で冪等。既存作品は NULL のまま（= 開始キーワード未設定）。
--   - 本番適用は別途承認制（このコードを deploy する前に本番DBへ適用すること）。

ALTER TABLE "works" ADD COLUMN IF NOT EXISTS "start_keyword" TEXT;
