-- 画像タップ「メッセージを送信する＋フェーズ遷移」(image_action_type="message_with_phase") の遷移先フェーズ ID。
-- additive・nullable・backfill 不要。既存行は NULL（= 旧アクションに影響なし）。
-- LINE payload には載せず、webhook 側で image_action_text 受信時に参照して遷移する。
ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "image_action_phase_id" TEXT NULL;
