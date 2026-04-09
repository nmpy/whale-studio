-- Step 1: viewer を enum に追加（この操作はトランザクション外で実行）
ALTER TYPE "MemberRole" ADD VALUE IF NOT EXISTS 'viewer';
