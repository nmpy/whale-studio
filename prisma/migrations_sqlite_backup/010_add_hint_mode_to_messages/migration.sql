-- prisma/migrations/010_add_hint_mode_to_messages/migration.sql
-- ヒント表示モード列を messages テーブルに追加
ALTER TABLE messages ADD COLUMN IF NOT EXISTS hint_mode TEXT NOT NULL DEFAULT 'always';
