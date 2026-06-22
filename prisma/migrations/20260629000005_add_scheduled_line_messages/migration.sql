-- 時間差メッセージ（予約送信）の予約テーブル。additive のみ（新規テーブル）。既存に影響なし。
-- 実 push 送信・cron は PR-4。PR-3 では pending/canceled の予約作成までを扱う。
CREATE TABLE IF NOT EXISTS "scheduled_line_messages" (
  "id"                 TEXT NOT NULL,
  "oa_id"              TEXT NOT NULL,
  "work_id"            TEXT NOT NULL,
  "line_user_id"       TEXT NOT NULL,
  "user_progress_id"   TEXT,
  "phase_id"           TEXT,
  "source_message_id"  TEXT,
  "trigger_type"       TEXT NOT NULL,
  "trigger_event_id"   TEXT,
  "due_at"             TIMESTAMP(3) NOT NULL,
  "status"             TEXT NOT NULL DEFAULT 'pending',
  "payload_json"       TEXT NOT NULL,
  "cancel_policy_json" TEXT,
  "idempotency_key"    TEXT NOT NULL,
  "line_request_id"    TEXT,
  "retry_count"        INTEGER NOT NULL DEFAULT 0,
  "last_error"         TEXT,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  "sent_at"            TIMESTAMP(3),
  "canceled_at"        TIMESTAMP(3),
  CONSTRAINT "scheduled_line_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_line_messages_idempotency_key_key" ON "scheduled_line_messages"("idempotency_key");
CREATE INDEX IF NOT EXISTS "scheduled_line_messages_status_due_at_idx" ON "scheduled_line_messages"("status", "due_at");
CREATE INDEX IF NOT EXISTS "scheduled_line_messages_line_user_id_work_id_status_idx" ON "scheduled_line_messages"("line_user_id", "work_id", "status");
CREATE INDEX IF NOT EXISTS "scheduled_line_messages_work_id_idx" ON "scheduled_line_messages"("work_id");

-- Work への FK（既存 onDelete: Cascade 方針に合わせる）。
ALTER TABLE "scheduled_line_messages"
  ADD CONSTRAINT "scheduled_line_messages_work_id_fkey"
  FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
