-- 015_add_checkin_attempts
-- GPS チェックイン試行ログテーブルを追加。
-- 成功/失敗問わず GPS 試行を記録し、成功率分析に使う。

CREATE TABLE IF NOT EXISTS "checkin_attempts" (
    "id"              TEXT NOT NULL PRIMARY KEY,
    "work_id"         TEXT NOT NULL,
    "location_id"     TEXT NOT NULL,
    "line_user_id"    TEXT NOT NULL,
    "method"          TEXT NOT NULL DEFAULT 'gps',
    "status"          TEXT NOT NULL,
    "failure_reason"  TEXT,
    "distance_meters" DOUBLE PRECISION,
    "lat"             DOUBLE PRECISION,
    "lng"             DOUBLE PRECISION,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "checkin_attempts_work_id_idx" ON "checkin_attempts"("work_id");
CREATE INDEX IF NOT EXISTS "checkin_attempts_location_id_idx" ON "checkin_attempts"("location_id");
CREATE INDEX IF NOT EXISTS "checkin_attempts_status_idx" ON "checkin_attempts"("status");
CREATE INDEX IF NOT EXISTS "checkin_attempts_created_at_idx" ON "checkin_attempts"("created_at");
