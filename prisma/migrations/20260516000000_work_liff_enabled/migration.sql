-- Work.liffEnabled を追加し、LIFF プレイヤー機能を work 単位で ON/OFF できるようにする。
--
-- 設計:
--   - DEFAULT TRUE — 既存 work は migrate 後も挙動が変わらない (引き続き LIFF アクセス可)
--   - NOT NULL — 取り扱いを単純化
--   - 将来 false に倒すと /api/liff/works/{id}/menu や個別ページ API が LIFF_DISABLED
--     を返す (実機からアクセス不可)。CMS の preview パスは liffEnabled を見ない
--     ので Studio 内では引き続き編集・プレビューできる。
ALTER TABLE "works"
  ADD COLUMN IF NOT EXISTS "liff_enabled" BOOLEAN NOT NULL DEFAULT TRUE;
