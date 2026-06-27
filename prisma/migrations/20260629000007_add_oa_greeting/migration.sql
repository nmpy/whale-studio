-- PR-1: OA単位の「あいさつメッセージ」基盤
-- あいさつメッセージ / follow_action を OA(oas) に nullable で追加し、
-- 既存の「アクティブ作品 先頭1件」の値をバックフィルする（既存値を失わない・移行期は webhook 側 fallback）。
--
-- 安全性:
--   - ADD COLUMN は nullable のため PostgreSQL ではテーブル書き換えなし（即時・実質ロックなし）。
--   - バックフィルは UPDATE のみ（DELETE/DROP なし）。active 作品がある OA だけ更新、無い OA は NULL のまま。
--   - works テーブルは読むだけ（不変）。resume_enabled / Work 側 welcome/follow は一切触らない。
--   - 先頭作品の選定は webhook の fetchActiveWork と同一: publish_status='active' を
--     sort_order ASC, created_at ASC, id ASC で並べた先頭1件。

-- 1) OA にカラム追加（nullable）
ALTER TABLE "oas" ADD COLUMN "welcome_message" TEXT;
ALTER TABLE "oas" ADD COLUMN "follow_action"   TEXT;

-- 2) 各OAの「アクティブ作品 先頭1件」から OA へバックフィル
UPDATE "oas" o SET
  "welcome_message" = w."welcome_message",
  "follow_action"   = w."follow_action"
FROM (
  SELECT DISTINCT ON (oa_id) oa_id, welcome_message, follow_action
  FROM "works"
  WHERE publish_status = 'active'
  ORDER BY oa_id, sort_order ASC, created_at ASC, id ASC
) w
WHERE o.id = w.oa_id;
