-- 匿名 CMS↔Whale Studio 連携（v2 Phase 1）用の追加的・後方互換マイグレーション。
-- 既存カラムの削除 / rename / 型変更 / backfill は行わない（すべて nullable の ADD COLUMN と索引追加のみ）。
--
-- 検証: origin/main の schema と本 schema の `prisma migrate diff --from-schema-datamodel ... --to-schema-datamodel ...`
--       （shadow DB 不要・DB 非接続）の出力と本ファイルは同一の変更セット。意図した列/索引のみを含む。
--
-- nullable 複合 unique について: PostgreSQL は NULL を互いに distinct 扱いにするため、
-- 既存行（external_session_ref / external_booking_ref = NULL）は衝突せず、backfill 不要で安全に適用できる。

-- AlterTable
ALTER TABLE "live_ticket_link_tokens" ADD COLUMN     "external_booking_ref" TEXT,
ADD COLUMN     "external_session_ref" TEXT;

-- AlterTable
ALTER TABLE "live_sessions" ADD COLUMN     "external_session_ref" TEXT;

-- AlterTable
ALTER TABLE "live_teams" ADD COLUMN     "capacity" INTEGER,
ADD COLUMN     "external_booking_ref" TEXT;

-- CreateIndex
CREATE INDEX "live_ticket_link_tokens_ext_refs_idx" ON "live_ticket_link_tokens"("oa_id", "work_id", "external_session_ref", "external_booking_ref");

-- CreateIndex
CREATE UNIQUE INDEX "live_sessions_oa_work_external_session_ref_key" ON "live_sessions"("oa_id", "work_id", "external_session_ref");

-- CreateIndex
CREATE UNIQUE INDEX "live_teams_session_external_booking_ref_key" ON "live_teams"("live_session_id", "external_booking_ref");
