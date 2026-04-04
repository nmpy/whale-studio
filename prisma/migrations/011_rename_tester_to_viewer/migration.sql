-- 011_rename_tester_to_viewer
-- MemberRole enum の tester 値を viewer に変更する
-- PostgreSQL では enum の rename は直接できないため、
-- 新値追加 → データ更新 → 旧値削除 の手順を踏む

-- 1. enum に viewer を追加
ALTER TYPE "MemberRole" ADD VALUE IF NOT EXISTS 'viewer';

-- 2. 既存レコードを tester → viewer に更新
UPDATE "workspace_members" SET "role" = 'viewer' WHERE "role" = 'tester';
UPDATE "invitations"        SET "role" = 'viewer' WHERE "role" = 'tester';

-- 3. デフォルト値を viewer に変更
ALTER TABLE "workspace_members" ALTER COLUMN "role" SET DEFAULT 'viewer';

-- ⚠ PostgreSQL では ADD VALUE 後にトランザクション内で値を削除できないため、
--   tester 値の削除はデータ移行完了後に別途実施が必要。
--   実運用上は viewer が正となるため、tester は使われなくなる。
