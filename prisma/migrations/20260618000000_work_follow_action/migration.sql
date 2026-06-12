-- 友だち追加(follow)時の動作を作品単位で選べるようにする。
--   auto_start   = 友だち追加直後に自動開始（既存挙動・既定）
--   welcome_wait = あいさつメッセージを送り「はじめる」を待つ（progress 未作成）
--   none         = 何もしない
-- 既存作品の挙動を壊さないため default 'auto_start'。非破壊（ADD COLUMN + DEFAULT）。
ALTER TABLE "works" ADD COLUMN "follow_action" TEXT NOT NULL DEFAULT 'auto_start';
