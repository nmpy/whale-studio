-- 時間差メッセージ（予約送信）の設定カラム。additive な ADD COLUMN のみ・既存に影響なし。
-- PR-4c-1: 保存のみ。runtime/webhook では未使用。JSON 文字列で 6 設定をまとめて保持。
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "scheduled_message_settings" TEXT NULL;
