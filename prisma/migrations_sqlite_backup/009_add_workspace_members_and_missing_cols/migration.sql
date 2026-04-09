-- prisma/migrations/009_add_workspace_members_and_missing_cols/migration.sql
--
-- このマイグレーションで追加するもの:
--   1. workspace_members テーブル（OA 単位のメンバー管理）
--   2. oas.line_oa_id 列（LINE Basic ID、スキーマには存在するが初期 migration 漏れ）
--   3. friend_add_settings.share_image_url 列（スキーマには存在するが migration 008 漏れ）
--
-- ⚠ 既に列/テーブルが存在する場合はエラーになるため、
--   本番 DB の状態に応じて IF NOT EXISTS 句で保護してある。

-- ────────────────────────────────────────────────
-- 1. workspace_members
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "workspace_members" (
    "id"           TEXT        NOT NULL,
    "workspace_id" TEXT        NOT NULL,
    "user_id"      TEXT        NOT NULL,
    "role"         TEXT        NOT NULL DEFAULT 'viewer',
    "invited_by"   TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspace_members_workspace_id_user_id_key" UNIQUE ("workspace_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "workspace_members_workspace_id_idx" ON "workspace_members"("workspace_id");
CREATE INDEX IF NOT EXISTS "workspace_members_user_id_idx"      ON "workspace_members"("user_id");
CREATE INDEX IF NOT EXISTS "workspace_members_role_idx"         ON "workspace_members"("role");

-- ────────────────────────────────────────────────
-- 2. oas.line_oa_id（NULL 許容、UNIQUE）
-- ────────────────────────────────────────────────
-- PostgreSQL では "IF NOT EXISTS" を使えないため、
-- 列が既に存在する環境では手動でスキップしてください。
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'oas' AND column_name = 'line_oa_id'
    ) THEN
        ALTER TABLE "oas" ADD COLUMN "line_oa_id" TEXT;
        CREATE UNIQUE INDEX "oas_line_oa_id_key" ON "oas"("line_oa_id");
    END IF;
END $$;

-- ────────────────────────────────────────────────
-- 3. friend_add_settings.share_image_url（NULL 許容）
-- ────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'friend_add_settings' AND column_name = 'share_image_url'
    ) THEN
        ALTER TABLE "friend_add_settings" ADD COLUMN "share_image_url" TEXT;
    END IF;
END $$;
