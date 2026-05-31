-- /api/oas/[id]/members の `where: { lastSeenAt: { gte }, userId: { notIn } }, take: 50` の
-- 絞り込み効率を改善する複合 index を追加する。
-- 既存 index:
--   - app_activity_logs_user_id_key       (UNIQUE on user_id)
--   - app_activity_logs_last_seen_at_idx  (BTree on last_seen_at)
-- いずれとも名前が衝突しないことを確認済み。CREATE INDEX のみで既存挙動には影響しない。
CREATE INDEX "app_activity_logs_last_seen_at_user_id_idx" ON "app_activity_logs"("last_seen_at", "user_id");
