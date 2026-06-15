-- 送信後の待機トリガー（地点到着で自動進行）— Beacon 検知対応の前提となる beacon→Location 紐づけ。
-- 完全 additive: beacon_triggers に location_id を ADD COLUMN（nullable・FK SetNull）+ index。
-- 既存挙動に非干渉（NULL = 従来どおり）。本番先行適用で無停止・安全。

ALTER TABLE "beacon_triggers" ADD COLUMN "location_id" TEXT;

CREATE INDEX "beacon_triggers_location_id_idx" ON "beacon_triggers"("location_id");

ALTER TABLE "beacon_triggers" ADD CONSTRAINT "beacon_triggers_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
