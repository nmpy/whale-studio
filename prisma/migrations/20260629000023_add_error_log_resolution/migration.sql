-- CreateTable: スタジオ全体エラーログ（Phase 2）の横断的な解決状態。
-- 既存の失敗ログ 3 種（beacon_event_logs / checkin_attempts / scheduled_line_messages）は変更しない。
-- 行が存在 = 解決済み / 行が無い = 未解決 / 再オープン = 行を削除。backfill 不要（適用前の既存ログは全て未解決扱い）。
CREATE TABLE "error_log_resolutions" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "resolved_at" TIMESTAMP(3) NOT NULL,
    "resolved_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "error_log_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "error_log_resolutions_oa_id_resolved_at_idx" ON "error_log_resolutions"("oa_id", "resolved_at");

-- CreateIndex
CREATE INDEX "error_log_resolutions_resolved_at_idx" ON "error_log_resolutions"("resolved_at");

-- CreateIndex
CREATE UNIQUE INDEX "error_log_resolutions_source_source_id_key" ON "error_log_resolutions"("source", "source_id");

-- AddForeignKey
ALTER TABLE "error_log_resolutions" ADD CONSTRAINT "error_log_resolutions_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
