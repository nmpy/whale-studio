-- LiveTeam に現地公演運営（Operation Belkish）の予約/部屋情報を追加（PR2b-0）。
-- すべて nullable な ADD COLUMN でゼロダウンタイム・完全後方互換（既存行は全て NULL）。
--   reserved_at    : 公演予約日時
--   purchaser_name : 購入者名
--   group_type     : グループ種別（"two" | "four"・表示 2人/4人）
--   room_number    : 部屋番号（手動紐付け）
--   ticket_id      : チケットID（照合・PR2b 照合キー候補）
ALTER TABLE "live_teams" ADD COLUMN "reserved_at"    TIMESTAMP(3);
ALTER TABLE "live_teams" ADD COLUMN "purchaser_name" TEXT;
ALTER TABLE "live_teams" ADD COLUMN "group_type"     TEXT;
ALTER TABLE "live_teams" ADD COLUMN "room_number"    TEXT;
ALTER TABLE "live_teams" ADD COLUMN "ticket_id"      TEXT;

-- 照合高速化用インデックス（ticketId・active公演 × チケットID/予約番号照合）。
CREATE INDEX "live_teams_live_session_id_ticket_id_idx" ON "live_teams"("live_session_id", "ticket_id");
