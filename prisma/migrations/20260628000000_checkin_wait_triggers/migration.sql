-- 送信後の待機トリガー（地点到着で自動進行）— 初回PR: QR + GPS
-- 完全 additive:
--   1. messages に待機トリガー設定 4 列を ADD COLUMN（すべて nullable / FK なし = graceful lookup）
--   2. checkin_wait_triggers テーブルを新規作成（per-user pending 状態 + 二重送信防止）
-- 既存コードは未参照のため本番先行適用で無停止・安全。

-- 1. Message: 送信後の待機トリガー設定
ALTER TABLE "messages" ADD COLUMN "checkin_trigger_type"            TEXT;
ALTER TABLE "messages" ADD COLUMN "checkin_trigger_location_id"     TEXT;
ALTER TABLE "messages" ADD COLUMN "checkin_trigger_next_message_id" TEXT;
ALTER TABLE "messages" ADD COLUMN "checkin_trigger_next_phase_id"   TEXT;

-- 2. CheckinWaitTrigger: per-user pending 状態
CREATE TABLE "checkin_wait_triggers" (
    "id"                TEXT NOT NULL,
    "oa_id"             TEXT NOT NULL,
    "work_id"           TEXT NOT NULL,
    "line_user_id"      TEXT NOT NULL,
    "source_message_id" TEXT,
    "phase_id"          TEXT,
    "location_id"       TEXT NOT NULL,
    "trigger_type"      TEXT NOT NULL,
    "next_message_id"   TEXT,
    "next_phase_id"     TEXT,
    "status"            TEXT NOT NULL DEFAULT 'pending',
    "idempotency_key"   TEXT NOT NULL,
    "armed_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at"       TIMESTAMP(3),
    "expires_at"        TIMESTAMP(3),
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkin_wait_triggers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "checkin_wait_triggers_idempotency_key_key" ON "checkin_wait_triggers"("idempotency_key");
CREATE INDEX "checkin_wait_triggers_line_user_id_work_id_status_idx" ON "checkin_wait_triggers"("line_user_id", "work_id", "status");
CREATE INDEX "checkin_wait_triggers_location_id_status_idx" ON "checkin_wait_triggers"("location_id", "status");
CREATE INDEX "checkin_wait_triggers_work_id_idx" ON "checkin_wait_triggers"("work_id");

ALTER TABLE "checkin_wait_triggers" ADD CONSTRAINT "checkin_wait_triggers_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "checkin_wait_triggers" ADD CONSTRAINT "checkin_wait_triggers_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
