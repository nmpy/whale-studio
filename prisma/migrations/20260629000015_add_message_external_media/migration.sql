-- メッセージ動画の「外部URL参照」対応の DB 土台（PR1）。
-- messages に nullable メタデータ列を追加する。動画/画像本体は保存しない（URL + メタのみ）。
--
-- 追加列:
--   asset_media_source   -- "upload" | "external_url"。null = 既存（従来のアップロード扱い）
--   asset_preview_url    -- 動画の previewImageUrl 専用（JPEG/PNG サムネURL。mp4 の asset_url 流用を廃止するため）
--   asset_mime_type      -- 例: "video/mp4" / "image/jpeg"
--   asset_file_size_bytes-- ファイルサイズ(bytes)。LIFF 大容量(>2GB)も見据え BIGINT
--   asset_duration_ms    -- 尺(ms)
--   asset_width          -- 幅(px)
--   asset_height         -- 高さ(px)
--   asset_usage          -- "line_video" | "liff_playback" | "cms_preview"。null = 用途未指定
--
-- 安全性:
--   - additive のみ（nullable カラム追加）。既存テーブル/データは保持。
--   - nullable のため PostgreSQL ではテーブル書き換えなし（即時・実質ロックなし）。
--   - 既存行はすべて NULL のまま（backfill しない）。null の asset_media_source は従来のアップロード扱い。
--   - IF NOT EXISTS で冪等。本番適用は別途承認制（このコードを deploy する前に本番DBへ適用すること）。
--   - 挙動変更なし（バリデーション/送信/UI の変更は PR2 以降）。

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "asset_media_source"    TEXT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "asset_preview_url"     TEXT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "asset_mime_type"       TEXT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "asset_file_size_bytes" BIGINT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "asset_duration_ms"     INTEGER;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "asset_width"           INTEGER;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "asset_height"          INTEGER;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "asset_usage"           TEXT;
