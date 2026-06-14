-- 謎・問題ブロックの拡張（additive・既存データ無影響）:
--   - answers              : 複数正解（JSON 配列文字列）。null = 既存 answer 単一のみ。
--   - correct_character_id  : 正解メッセージの発話キャラクター ID（FK なし・lookup で解決）。
--   - incorrect_character_id: 不正解メッセージの発話キャラクター ID（FK なし・lookup で解決）。
-- いずれも NULL 許容の追加カラムのみ。既存行は NULL となり従来挙動を維持する。
ALTER TABLE "messages" ADD COLUMN "answers" TEXT;
ALTER TABLE "messages" ADD COLUMN "correct_character_id" TEXT;
ALTER TABLE "messages" ADD COLUMN "incorrect_character_id" TEXT;
