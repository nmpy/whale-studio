-- 014_add_gps_stamp_fields
-- Location に GPS チェックイン設定 + スタンプラリー設定を追加
-- LocationVisit にチェックイン方式 + GPS 距離を追加
--
-- すべて nullable / default 付きのため既存データに影響なし

-- ── Location: GPS 設定 ──
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "radius_meters" INTEGER;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "gps_enabled" BOOLEAN NOT NULL DEFAULT false;

-- ── Location: スタンプラリー設定 ──
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "stamp_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "stamp_label" TEXT;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "stamp_order" INTEGER;

-- ── LocationVisit: チェックイン方式 + 距離 ──
ALTER TABLE "location_visits" ADD COLUMN IF NOT EXISTS "checkin_method" TEXT NOT NULL DEFAULT 'qr';
ALTER TABLE "location_visits" ADD COLUMN IF NOT EXISTS "distance_meters" DOUBLE PRECISION;
