-- Location に「QR 読み取り成功時に LINE push 送信するメッセージ」への任意 FK を追加する。
-- additive: nullable ADD COLUMN + ON DELETE SET NULL の FK のみ。既存行は NULL で埋まり、
-- QR 成功 API は message 未設定なら message_not_configured を返す（既存挙動に影響なし / non-breaking）。
ALTER TABLE "locations" ADD COLUMN "qr_success_message_id" TEXT;

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_qr_success_message_id_fkey"
  FOREIGN KEY ("qr_success_message_id") REFERENCES "messages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "locations_qr_success_message_id_idx" ON "locations"("qr_success_message_id");
