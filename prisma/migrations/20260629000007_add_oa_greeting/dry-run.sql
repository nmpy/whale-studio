-- PR-1 バックフィル dry-run（読み取り専用 SELECT のみ／本番DBへの書き込みはしない）
-- 本番適用前に、これらを Session Pooler(5432) 接続で実行し件数を確認する。

-- (1) バックフィル対象になる OA 件数（active 作品が1件以上ある OA）
SELECT count(DISTINCT oa_id) AS oa_with_active_work
FROM "works" WHERE publish_status = 'active';

-- (2) active 作品が存在しない OA 件数（バックフィルされず NULL のまま）
SELECT count(*) AS oa_without_active_work
FROM "oas" o
WHERE NOT EXISTS (
  SELECT 1 FROM "works" w WHERE w.oa_id = o.id AND w.publish_status = 'active'
);

-- (3) 複数 active 作品がある OA 件数（先頭1件のみ採用）
SELECT count(*) AS oa_with_multiple_active FROM (
  SELECT oa_id FROM "works" WHERE publish_status = 'active'
  GROUP BY oa_id HAVING count(*) > 1
) t;

-- (4) 各OAで採用される active 作品の確認（fetchActiveWork と同一の選定）
--     ※ 確認用。全件多い場合は LIMIT を付ける。
SELECT DISTINCT ON (oa_id)
  oa_id,
  id   AS chosen_work_id,
  sort_order, created_at,
  (welcome_message IS NOT NULL AND btrim(welcome_message) <> '') AS has_welcome,
  follow_action,
  left(coalesce(welcome_message, ''), 30) AS welcome_head
FROM "works"
WHERE publish_status = 'active'
ORDER BY oa_id, sort_order ASC, created_at ASC, id ASC;

-- (5) バックフィル後に入る予定値の概要（welcome の null/非null 件数・follow_action の分布）
WITH chosen AS (
  SELECT DISTINCT ON (oa_id) oa_id, welcome_message, follow_action
  FROM "works" WHERE publish_status = 'active'
  ORDER BY oa_id, sort_order ASC, created_at ASC, id ASC
)
SELECT
  count(*)                                                            AS oa_to_backfill,
  count(*) FILTER (WHERE welcome_message IS NOT NULL
                     AND btrim(welcome_message) <> '')                AS welcome_nonnull,
  count(*) FILTER (WHERE welcome_message IS NULL
                     OR btrim(welcome_message) = '')                  AS welcome_null_or_empty,
  count(*) FILTER (WHERE follow_action = 'auto_start')                AS fa_auto_start,
  count(*) FILTER (WHERE follow_action = 'welcome_wait')              AS fa_welcome_wait,
  count(*) FILTER (WHERE follow_action = 'none')                      AS fa_none
FROM chosen;
