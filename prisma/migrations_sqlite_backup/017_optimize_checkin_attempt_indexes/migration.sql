-- 017_optimize_checkin_attempt_indexes
-- CheckinAttempt のクエリパターンに最適化した index を追加。
-- 旧 index (workId, locationId, status 単独) を削除し、
-- dedupe / cleanup / stats 用の複合 index に置き換える。

-- 旧 index 削除（安全: IF EXISTS）
DROP INDEX IF EXISTS "checkin_attempts_work_id_idx";
DROP INDEX IF EXISTS "checkin_attempts_location_id_idx";
DROP INDEX IF EXISTS "checkin_attempts_status_idx";

-- dedupe 用複合 index: hasDuplicateAttempt() の WHERE 句に最適化
-- (workId, locationId, lineUserId, status, createdAt) の等値 + 範囲検索
CREATE INDEX IF NOT EXISTS "checkin_attempts_dedupe_idx"
  ON "checkin_attempts" ("work_id", "location_id", "line_user_id", "status", "created_at");

-- work/status 集計用: Audience stats の groupBy(status) WHERE workId に最適化
CREATE INDEX IF NOT EXISTS "checkin_attempts_work_status_idx"
  ON "checkin_attempts" ("work_id", "status");

-- retention cleanup 用: createdAt < cutoff は既存 index で対応済み
-- checkin_attempts_created_at_idx は維持
