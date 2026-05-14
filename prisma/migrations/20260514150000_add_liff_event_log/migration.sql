-- LIFF プレイヤー画面で発生したイベントを記録するテーブル。
-- page_view / button_click / hint_open / faq_open / survey_submit / checkin_success / checkin_failed
-- を 1 イベント 1 行で保存する。

CREATE TABLE "liff_event_logs" (
    "id"                   TEXT         NOT NULL,
    "work_id"              TEXT         NOT NULL,
    "liff_page_config_id"  TEXT,
    "liff_page_block_id"   TEXT,
    "line_user_id"         TEXT,
    "event_type"           TEXT         NOT NULL,
    "metadata_json"        JSONB,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liff_event_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "liff_event_logs_work_id_idx"             ON "liff_event_logs"("work_id");
CREATE INDEX "liff_event_logs_liff_page_config_id_idx" ON "liff_event_logs"("liff_page_config_id");
CREATE INDEX "liff_event_logs_liff_page_block_id_idx"  ON "liff_event_logs"("liff_page_block_id");
CREATE INDEX "liff_event_logs_line_user_id_idx"        ON "liff_event_logs"("line_user_id");
CREATE INDEX "liff_event_logs_event_type_idx"          ON "liff_event_logs"("event_type");
CREATE INDEX "liff_event_logs_created_at_idx"          ON "liff_event_logs"("created_at");
-- 集計クエリ最適化用: workId + eventType + createdAt
CREATE INDEX "liff_event_logs_work_id_event_type_created_at_idx" ON "liff_event_logs"("work_id", "event_type", "created_at");

ALTER TABLE "liff_event_logs"
  ADD CONSTRAINT "liff_event_logs_work_id_fkey"
  FOREIGN KEY ("work_id") REFERENCES "works"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
