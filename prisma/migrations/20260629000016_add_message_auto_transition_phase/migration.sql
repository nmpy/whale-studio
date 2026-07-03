-- メッセージ送信後の silent 自動フェーズ遷移の土台（Path B）。
-- messages に nullable な auto_transition_phase_id を追加する。
--
--   auto_transition_phase_id -- このメッセージ送信完了後に、入力を待たず silent に遷移する先フェーズ ID。
--                               null = 無効（既存挙動）。遷移先の入場メッセージは送らず currentPhaseId のみ更新する。
--
-- 安全性:
--   - additive のみ（nullable カラム追加）。既存テーブル/データは保持。
--   - nullable のため PostgreSQL ではテーブル書き換えなし（即時・実質ロックなし）。
--   - 既存行は NULL のまま（backfill しない）。null は「自動遷移なし＝従来挙動」。
--   - IF NOT EXISTS で冪等。本番適用は別途承認制（このコードを deploy する前に本番DBへ適用すること）。
--   - 挙動変更なし（runtime/UI の適用は同PRのアプリコード側）。

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "auto_transition_phase_id" TEXT;
