-- Stripe Webhook の idempotency 制御テーブル。
--
-- 目的:
--   Stripe が同じ event を再送した場合の二重処理を防ぐ。
--   - 受信直後に stripe_event_id を unique INSERT (= reserve)
--   - 既存なら 200 を返してスキップ
--   - 処理成功 / 失敗を status + processed_at に記録
--   - 失敗は error_message に残し、管理者が後から確認できるようにする
--
-- 設計メモ:
--   - id は内部 UUID (PRIMARY KEY)、stripe_event_id を別 UNIQUE 列にする
--     (= 外部 ID と内部 ID を分離して、将来 Stripe 以外の決済を扱うときも揃えやすい)
--   - status は "received" | "processed" | "failed" の 3 値、CHECK 制約は付けない
--     (= アプリ側で文字列管理、将来の状態追加に備える)
--   - 既存テーブル / 既存挙動には一切影響しない (= 新規 additive)

CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
  "id"              TEXT          PRIMARY KEY,
  "stripe_event_id" TEXT          NOT NULL,
  "event_type"      TEXT          NOT NULL,
  "status"          TEXT          NOT NULL DEFAULT 'received',
  "error_message"   TEXT,
  "received_at"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at"    TIMESTAMP(3)
);

CREATE UNIQUE INDEX IF NOT EXISTS "stripe_webhook_events_stripe_event_id_key"
  ON "stripe_webhook_events" ("stripe_event_id");

CREATE INDEX IF NOT EXISTS "stripe_webhook_events_event_type_idx"
  ON "stripe_webhook_events" ("event_type");

CREATE INDEX IF NOT EXISTS "stripe_webhook_events_status_idx"
  ON "stripe_webhook_events" ("status");

CREATE INDEX IF NOT EXISTS "stripe_webhook_events_received_at_idx"
  ON "stripe_webhook_events" ("received_at");
