-- 012_add_app_activity_log
-- アプリ操作ユーザー記録テーブルを追加する
-- 認証済みで操作したユーザーを記録し、メンバー招待候補の母集団として使用する

CREATE TABLE IF NOT EXISTS "app_activity_logs" (
  "id"           TEXT        NOT NULL PRIMARY KEY,
  "user_id"      TEXT        NOT NULL UNIQUE,
  "email"        TEXT,
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "app_activity_logs_last_seen_at_idx"
  ON "app_activity_logs"("last_seen_at");
