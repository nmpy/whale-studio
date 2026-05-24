-- 画像メッセージのタップ時アクション設定。
--
-- 追加対象 (messages テーブル):
--   image_action_type          (TEXT, nullable) — "message" | "uri" | "liff" | "postback" | NULL
--   image_action_text          (TEXT, nullable) — type="message" 時、プレイヤーから送信されるテキスト
--   image_action_url           (TEXT, nullable) — type="uri" 時、開く外部 URL (HTTPS)
--   image_action_liff_page_id  (TEXT, nullable) — type="liff" 時、対象 LIFF ページ ID
--   image_action_postback_data (TEXT, nullable) — type="postback" 時、postback data
--
-- 設計メモ:
--   - すべて nullable で additive。既存メッセージ・既存挙動には一切影響しない。
--   - LINE 送信側で imageActionType が設定されている場合のみ Flex Message に変換する。
--   - 既存の tap_destination_id / tap_url は別概念（タップ→Destination 遷移）のため触らない。
--   - altText は既存の messages.alt_text を再利用するため新規追加しない。

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "image_action_type"          TEXT NULL,
  ADD COLUMN IF NOT EXISTS "image_action_text"          TEXT NULL,
  ADD COLUMN IF NOT EXISTS "image_action_url"           TEXT NULL,
  ADD COLUMN IF NOT EXISTS "image_action_liff_page_id"  TEXT NULL,
  ADD COLUMN IF NOT EXISTS "image_action_postback_data" TEXT NULL;
