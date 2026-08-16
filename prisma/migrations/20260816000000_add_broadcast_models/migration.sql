-- 配信メッセージ（Broadcast / BroadcastRecipient）
--
-- additive only。既存テーブル（messages / user_progress / segments / oas 等）への
-- 変更は一切行わない。既存「応答メッセージ」機能のデータ・スキーマには触れない。

CREATE TABLE IF NOT EXISTS "broadcasts" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "target_type" TEXT NOT NULL,
    "segment_id" TEXT,
    "segment_work_id" TEXT,
    "content_json" JSONB NOT NULL,
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "broadcast_recipients" (
    "id" TEXT NOT NULL,
    "broadcast_id" TEXT NOT NULL,
    "line_user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "http_status" INTEGER,
    "error_message" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broadcast_recipients_pkey" PRIMARY KEY ("id")
);

-- 一覧・履歴表示用
CREATE INDEX IF NOT EXISTS "broadcasts_oa_id_created_at_idx" ON "broadcasts"("oa_id", "created_at");
CREATE INDEX IF NOT EXISTS "broadcasts_oa_id_status_idx" ON "broadcasts"("oa_id", "status");

-- 同一配信で同じ宛先を二重に持たない（二重送信防止の最終防壁）
CREATE UNIQUE INDEX IF NOT EXISTS "broadcast_recipients_broadcast_id_line_user_id_key"
    ON "broadcast_recipients"("broadcast_id", "line_user_id");
-- worker の未送信 claim 用
CREATE INDEX IF NOT EXISTS "broadcast_recipients_broadcast_id_status_idx"
    ON "broadcast_recipients"("broadcast_id", "status");

ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_oa_id_fkey"
    FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_fkey"
    FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
