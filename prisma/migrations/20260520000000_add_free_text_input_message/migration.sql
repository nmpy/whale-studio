-- 自由入力受付モード (free text input) Phase 1 — DB 構造のみ。
--
-- 追加対象:
--   user_progress.variables          (TEXT, default '{}')      — ユーザー入力で保存された変数の JSON 文字列
--   user_progress.waiting_for_input  (TEXT, nullable)          — 自由入力待ち状態のメタ JSON。null = 通常
--   messages.free_input_enabled         (BOOLEAN, default FALSE) — このメッセージ送信後に自由入力を受け付けるか
--   messages.free_input_variable_key    (TEXT, nullable)         — 保存先変数名
--   messages.free_input_next_message_id (TEXT, nullable, FK)     — 入力後に進む次メッセージ (自己参照)
--
-- 既存データへの影響:
--   すべて additive (default あり / nullable)。既存挙動は無変更。
--   既存 user_progress.flags は触らない。
--   既存 messages.next_message_id (連続送信用) は触らない。
--
-- 設計メモ:
--   - variables / waiting_for_input は SQLite/PG 共用方針で TEXT (JSON 文字列) 保持
--   - free_input_next_message_id は自己参照 FK で ON DELETE SET NULL
--     (= 参照先メッセージが削除されたら NULL にして残しを許容)

-- ── user_progress ──────────────────────────────────────
ALTER TABLE "user_progress"
  ADD COLUMN IF NOT EXISTS "variables"         TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "user_progress"
  ADD COLUMN IF NOT EXISTS "waiting_for_input" TEXT NULL;

-- ── messages ───────────────────────────────────────────
ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "free_input_enabled"          BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "free_input_variable_key"     TEXT NULL;
ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "free_input_next_message_id"  TEXT NULL;

-- 自己参照 FK (= next_message_id と同じパターン)
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_free_input_next_message_id_fkey"
    FOREIGN KEY ("free_input_next_message_id") REFERENCES "messages"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "messages_free_input_next_message_id_idx"
  ON "messages"("free_input_next_message_id");
