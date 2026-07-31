-- アンケート「回答済み判定」と「重複回答防止」の基盤。
-- additive・非破壊: nullable 列追加 + FK(SET NULL) + index + unique(nullable) のみ。
--   既存の liff_survey_responses 行・他テーブルは一切変更しない。
--   dedupe_key は「複数回答許可 / 匿名 / 旧経路」では NULL とし、PostgreSQL の UNIQUE が
--   NULL を重複扱いしない性質を使って「非 null のみ一意」を実現する（partial index 不要・Prisma ネイティブ）。

-- 1) 回答をアンケートページ(LiffPageConfig, pageType=survey)へ紐付ける列（既存行は NULL）。
ALTER TABLE "liff_survey_responses" ADD COLUMN "liff_page_config_id" TEXT;

-- 2) 重複回答防止キー（= `${liff_page_config_id}:${line_user_id}`）。複数回答許可/匿名/旧経路は NULL。
ALTER TABLE "liff_survey_responses" ADD COLUMN "dedupe_key" TEXT;

-- 3) FK。ページ削除時は回答データを残すため SET NULL。
ALTER TABLE "liff_survey_responses"
  ADD CONSTRAINT "liff_survey_responses_liff_page_config_id_fkey"
  FOREIGN KEY ("liff_page_config_id") REFERENCES "liff_page_configs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) 回答済み判定用の検索 index（schema の @@index([liffPageConfigId, lineUserId]) と同名・同定義）。
CREATE INDEX "liff_survey_responses_liff_page_config_id_line_user_id_idx"
  ON "liff_survey_responses"("liff_page_config_id", "line_user_id");

-- 5) 重複回答防止の unique（非 null のみ一意 = 同一アンケート×同一 LINE ユーザーは 1 回。
--    複数回答許可時は dedupe_key=NULL で無制限）。競合送信は 1 件だけ通り残りは P2002→409。
CREATE UNIQUE INDEX "liff_survey_responses_dedupe_key_key"
  ON "liff_survey_responses"("dedupe_key");
