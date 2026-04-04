-- Step 2: データ移行とデフォルト値変更
UPDATE "workspace_members" SET "role" = 'viewer' WHERE "role" = 'tester';
UPDATE "invitations"        SET "role" = 'viewer' WHERE "role" = 'tester';
ALTER TABLE "workspace_members" ALTER COLUMN "role" SET DEFAULT 'viewer';
