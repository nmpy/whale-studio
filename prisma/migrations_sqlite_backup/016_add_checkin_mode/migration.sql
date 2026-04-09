-- 016_add_checkin_mode
-- Location にチェックイン方式フィールドを追加。
-- 既存 location は "qr_only" がデフォルト（従来互換）。
-- gps_enabled=true の既存行は "gps_only" に移行。

ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "checkin_mode" TEXT NOT NULL DEFAULT 'qr_only';

-- 既存データ移行: gps_enabled=true → checkin_mode='gps_only'
UPDATE "locations" SET "checkin_mode" = 'gps_only' WHERE "gps_enabled" = true AND "checkin_mode" = 'qr_only';
