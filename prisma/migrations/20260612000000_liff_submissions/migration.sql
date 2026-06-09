-- LIFF フォーム/アンケート送信を保存する LiffSubmission テーブルを追加する。
-- additive: 新規テーブルのみ。既存テーブルへの変更なし（non-breaking）。
CREATE TABLE "liff_submissions" (
    "id"           TEXT NOT NULL,
    "oa_id"        TEXT NOT NULL,
    "work_id"      TEXT NOT NULL,
    "liff_page_id" TEXT NOT NULL,
    "line_user_id" TEXT,
    "player_id"    TEXT,
    "display_name" TEXT,
    "answers_json" JSONB NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "liff_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "liff_submissions_oa_id_idx"        ON "liff_submissions"("oa_id");
CREATE INDEX "liff_submissions_work_id_idx"      ON "liff_submissions"("work_id");
CREATE INDEX "liff_submissions_liff_page_id_idx" ON "liff_submissions"("liff_page_id");
CREATE INDEX "liff_submissions_line_user_id_idx" ON "liff_submissions"("line_user_id");
CREATE INDEX "liff_submissions_created_at_idx"   ON "liff_submissions"("created_at");

ALTER TABLE "liff_submissions" ADD CONSTRAINT "liff_submissions_oa_id_fkey"
  FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "liff_submissions" ADD CONSTRAINT "liff_submissions_work_id_fkey"
  FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "liff_submissions" ADD CONSTRAINT "liff_submissions_liff_page_id_fkey"
  FOREIGN KEY ("liff_page_id") REFERENCES "liff_page_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
