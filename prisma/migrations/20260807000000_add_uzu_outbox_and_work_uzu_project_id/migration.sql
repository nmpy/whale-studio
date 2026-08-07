-- UZU Pro CMS 連携（Step 1）: transactional outbox と Work→UZU Project の対応。
--
-- **additive のみ**。既存カラム/インデックス/データへの破壊的変更・backfill は行わない。
--   1. works.uzu_project_id を nullable で追加（未設定なら UZU へ送らない＝既存挙動のまま）
--   2. uzu_outbox_events を新規作成
--
-- 既存の schema ドリフト（本 PR と無関係な index/default の差分）は意図的に含めない。

-- 1) Work → UZU Project の対応（nullable / 既定 NULL）
ALTER TABLE "works" ADD COLUMN IF NOT EXISTS "uzu_project_id" TEXT;

-- 2) 送信キュー（transactional outbox）
CREATE TABLE IF NOT EXISTS "uzu_outbox_events" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "uzu_project_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uzu_outbox_events_pkey" PRIMARY KEY ("id")
);

-- 同一業務イベントの重複作成を防ぐ（再リンク等の正当な別イベントは別キーになる）
CREATE UNIQUE INDEX IF NOT EXISTS "uzu_outbox_events_idempotency_key_key"
    ON "uzu_outbox_events"("idempotency_key");

-- worker の claim 用
CREATE INDEX IF NOT EXISTS "uzu_outbox_events_status_next_attempt_at_idx"
    ON "uzu_outbox_events"("status", "next_attempt_at");

-- 運用調査用
CREATE INDEX IF NOT EXISTS "uzu_outbox_events_oa_id_work_id_idx"
    ON "uzu_outbox_events"("oa_id", "work_id");

-- sending 滞留の回復用
CREATE INDEX IF NOT EXISTS "uzu_outbox_events_status_claimed_at_idx"
    ON "uzu_outbox_events"("status", "claimed_at");
