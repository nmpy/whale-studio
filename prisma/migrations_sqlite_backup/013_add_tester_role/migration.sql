-- 013_add_tester_role
-- MemberRole enum に tester 値を正式導入する
--
-- 背景:
--   011_rename_tester_to_viewer で tester → viewer に移行したが、
--   PostgreSQL では enum 値の削除がトランザクション内でできないため
--   'tester' 値は enum に残存していた。
--   今回、tester を課金前ユーザー向け体験ロールとして正式に再導入する。
--
-- ロール階層: owner > admin > editor > tester > viewer

-- tester 値が enum に存在しない場合のみ追加（残存していれば何もしない）
ALTER TYPE "MemberRole" ADD VALUE IF NOT EXISTS 'tester';

-- workspace_members の tester ロールデフォルト確認（viewer のまま維持）
-- 既存レコードへの影響なし
