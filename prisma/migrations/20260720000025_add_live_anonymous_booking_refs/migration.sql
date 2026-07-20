-- Anonymous CMS↔Whale Studio 連携（Phase 1）用の追加的・後方互換マイグレーション。
-- 既存カラムの削除 / rename / 型変更 / backfill は行わない（すべて nullable の ADD COLUMN と索引追加のみ）。
--
-- 追加内容:
--   live_sessions          : external_session_ref (匿名の公演参照) + 冪等 upsert 用 unique 索引
--   live_teams             : external_booking_ref (匿名の予約枠参照) + capacity + 冪等 upsert 用 unique 索引
--   live_ticket_link_tokens: external_session_ref / external_booking_ref (逆引き・監査用) + 複合索引
--
-- nullable 複合 unique について: PostgreSQL は NULL を互いに distinct 扱いにするため、
-- 既存行（external_session_ref / external_booking_ref = NULL）は衝突せず、backfill 不要で安全に適用できる。

-- AlterTable: live_sessions
ALTER TABLE "live_sessions" ADD COLUMN "external_session_ref" TEXT;

-- AlterTable: live_teams
ALTER TABLE "live_teams" ADD COLUMN "external_booking_ref" TEXT;
ALTER TABLE "live_teams" ADD COLUMN "capacity" INTEGER;

-- AlterTable: live_ticket_link_tokens
ALTER TABLE "live_ticket_link_tokens" ADD COLUMN "external_session_ref" TEXT;
ALTER TABLE "live_ticket_link_tokens" ADD COLUMN "external_booking_ref" TEXT;

-- CreateIndex: live_sessions 冪等 upsert キー（oa_id + work_id + external_session_ref）
CREATE UNIQUE INDEX "live_sessions_oa_work_external_session_ref_key" ON "live_sessions"("oa_id", "work_id", "external_session_ref");

-- CreateIndex: live_teams 冪等 upsert キー（live_session_id + external_booking_ref）
CREATE UNIQUE INDEX "live_teams_session_external_booking_ref_key" ON "live_teams"("live_session_id", "external_booking_ref");

-- CreateIndex: live_ticket_link_tokens 逆引き・監査用（unique にはしない = 再発行で履歴が複数残る）
CREATE INDEX "live_ticket_link_tokens_ext_refs_idx" ON "live_ticket_link_tokens"("oa_id", "work_id", "external_session_ref", "external_booking_ref");
