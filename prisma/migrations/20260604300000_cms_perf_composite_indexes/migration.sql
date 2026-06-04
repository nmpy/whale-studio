-- perf: CMS 一覧クエリ向け複合 index。
-- 既存の単独 index (= workId 単独 / sortOrder 単独) は heap fetch を伴うため、
-- `WHERE work_id=? ORDER BY sort_order` を sorted index scan に乗せる目的で追加。
--
-- IF NOT EXISTS は Prisma の migration 履歴重複時の安全策 (= 手動で先に作成済みでも fail しない)。
-- CONCURRENTLY は使えない (= Prisma migrate は transaction で wrap するため)。
-- データ量が大きい場合は事前に `CREATE INDEX CONCURRENTLY` を psql で実行することも可能だが、
-- 通常の OA 規模なら lock 期間は数秒以下を想定。

CREATE INDEX IF NOT EXISTS "works_oa_id_sort_order_idx"           ON "works"     ("oa_id",  "sort_order");
CREATE INDEX IF NOT EXISTS "phases_work_id_sort_order_idx"        ON "phases"    ("work_id", "sort_order");
CREATE INDEX IF NOT EXISTS "messages_work_id_sort_order_idx"      ON "messages"  ("work_id", "sort_order");
CREATE INDEX IF NOT EXISTS "messages_work_id_phase_id_sort_order_idx" ON "messages" ("work_id", "phase_id", "sort_order");
