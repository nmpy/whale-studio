-- UserProgress に frontier 用カラムを追加（QR 有効範囲を現在地に限定するため）。
-- nullable のため既存データ非破壊。旧コードは本カラムを参照しないので後方互換。
ALTER TABLE "user_progress" ADD COLUMN "last_sent_message_ids" TEXT;
