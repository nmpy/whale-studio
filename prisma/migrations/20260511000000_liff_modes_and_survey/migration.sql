-- LIFF: ページモード追加 (faq / survey / location) + Survey 回答保存テーブル
--
-- 1) 既存データの page_type "hint_site" を新名称 "hint" に rename
-- 2) liff_survey_responses テーブルを新規作成
--
-- page_type の値はカラム型が TEXT のため、enum 制約は無し。
-- 値の正規化は API 層 (updateLiffConfigSchema) と読み込み層 (normalizeLiffPageType) で行う。

-- 1) hint_site → hint に rename
UPDATE "liff_page_configs"
   SET "page_type" = 'hint'
 WHERE "page_type" = 'hint_site';

-- 2) Survey 回答保存テーブル
CREATE TABLE "liff_survey_responses" (
    "id"            TEXT        NOT NULL,
    "work_id"       TEXT        NOT NULL,
    "line_user_id"  TEXT,
    "answers_json"  JSONB       NOT NULL,
    "submitted_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liff_survey_responses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "liff_survey_responses_work_id_idx"      ON "liff_survey_responses"("work_id");
CREATE INDEX "liff_survey_responses_line_user_id_idx" ON "liff_survey_responses"("line_user_id");
CREATE INDEX "liff_survey_responses_submitted_at_idx" ON "liff_survey_responses"("submitted_at");

ALTER TABLE "liff_survey_responses"
  ADD CONSTRAINT "liff_survey_responses_work_id_fkey"
  FOREIGN KEY ("work_id") REFERENCES "works"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
