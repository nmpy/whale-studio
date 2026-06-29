-- スタジオ全体の単一グローバル設定テーブル（singleton）。
-- 今回は /oas のお知らせ最大表示件数（announcement_display_limit）を保持する。
--
-- 安全性:
--   - additive のみ（新規 CREATE TABLE）。既存テーブルは一切変更しない。
--   - IF NOT EXISTS で冪等。announcement_display_limit は nullable（未設定=NULL→アプリ側で既定 3）。
--   - 本番適用は別途承認制（このコードを deploy する前に本番DBへ適用すること）。
--   - 運用は id='singleton' の 1 行を upsert（読み書きとも id 固定）。

CREATE TABLE IF NOT EXISTS "studio_settings" (
  "id"                         TEXT NOT NULL,
  "announcement_display_limit" INTEGER,
  "created_at"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                 TIMESTAMP(3) NOT NULL,

  CONSTRAINT "studio_settings_pkey" PRIMARY KEY ("id")
);
