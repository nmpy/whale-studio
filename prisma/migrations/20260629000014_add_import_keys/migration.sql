-- スプレッドシート取り込み用の安定キーを characters / phases / messages に追加する（PR1）。
-- 取り込み(PR2以降)で character_key / phase_key / message_key により冪等 upsert する土台。
--
-- 安全性:
--   - additive のみ（nullable カラム追加 + 部分的に NULL 可の UNIQUE INDEX）。既存テーブル/データは保持。
--   - nullable のため PostgreSQL ではテーブル書き換えなし（即時・実質ロックなし）。
--   - 既存行は *_key = NULL のまま。PostgreSQL は UNIQUE INDEX 内で複数 NULL を許容するため衝突しない
--     （= 既存の手動作成データは従来どおり動作）。取り込みで作成/更新する行のみ key を必須にする(PR2)。
--   - IF NOT EXISTS で冪等。本番適用は別途承認制（このコードを deploy する前に本番DBへ適用すること）。
--   - 挙動変更なし（取り込み機能本体は PR2 以降）。

ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "character_key" TEXT;
ALTER TABLE "phases"     ADD COLUMN IF NOT EXISTS "phase_key"     TEXT;
ALTER TABLE "messages"   ADD COLUMN IF NOT EXISTS "message_key"   TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "characters_work_id_character_key_key" ON "characters"("work_id", "character_key");
CREATE UNIQUE INDEX IF NOT EXISTS "phases_work_id_phase_key_key"         ON "phases"("work_id", "phase_key");
CREATE UNIQUE INDEX IF NOT EXISTS "messages_work_id_message_key_key"     ON "messages"("work_id", "message_key");
