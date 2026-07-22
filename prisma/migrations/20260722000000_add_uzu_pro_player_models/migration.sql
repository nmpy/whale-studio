-- for ウズプロ（プレイヤー単位）PR1 基盤: 追加のみ・非破壊（新規 enum/table/index/FK のみ）。
-- 適用先: 本番/共有DBには適用しない（Draft PR。migration は別途 Session Pooler で手動適用）。
-- 個人情報カラムは持たない（氏名/メール/電話/住所/備考なし）。公演/回は既存 live_sessions を再利用。

-- CreateEnum
CREATE TYPE "UzuProBookingStatus" AS ENUM ('confirmed', 'waitlist', 'cancelled', 'attended');

-- CreateEnum
CREATE TYPE "UzuProPlayerStatus" AS ENUM ('active', 'cancelled');

-- CreateEnum
CREATE TYPE "UzuProLiffStatus" AS ENUM ('issued', 'revoked', 'linked', 'error');

-- CreateEnum
CREATE TYPE "UzuProSyncStatus" AS ENUM ('received', 'processed', 'failed');

-- CreateTable
CREATE TABLE "uzu_pro_grants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "granted_by" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uzu_pro_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uzu_pro_bookings" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "live_session_id" TEXT NOT NULL,
    "external_booking_id" TEXT NOT NULL,
    "participant_count" INTEGER NOT NULL,
    "status" "UzuProBookingStatus" NOT NULL DEFAULT 'confirmed',
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uzu_pro_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uzu_pro_players" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "external_player_id" TEXT,
    "external_ticket_id" TEXT,
    "player_index" INTEGER NOT NULL,
    "status" "UzuProPlayerStatus" NOT NULL DEFAULT 'active',
    "line_user_id" TEXT,
    "linked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uzu_pro_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uzu_pro_liff_links" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "UzuProLiffStatus" NOT NULL DEFAULT 'issued',
    "expires_at" TIMESTAMP(3),
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "linked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uzu_pro_liff_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uzu_pro_sync_requests" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_id" TEXT,
    "oa_id" TEXT,
    "work_id" TEXT,
    "external_booking_id" TEXT,
    "status" "UzuProSyncStatus" NOT NULL DEFAULT 'received',
    "error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "uzu_pro_sync_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uzu_pro_activity_logs" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT,
    "work_id" TEXT,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uzu_pro_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uzu_pro_grants_user_id_key" ON "uzu_pro_grants"("user_id");

-- CreateIndex
CREATE INDEX "uzu_pro_grants_user_id_idx" ON "uzu_pro_grants"("user_id");

-- CreateIndex
CREATE INDEX "uzu_pro_bookings_oa_id_work_id_idx" ON "uzu_pro_bookings"("oa_id", "work_id");

-- CreateIndex
CREATE INDEX "uzu_pro_bookings_live_session_id_idx" ON "uzu_pro_bookings"("live_session_id");

-- CreateIndex
CREATE INDEX "uzu_pro_bookings_work_id_status_idx" ON "uzu_pro_bookings"("work_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uzu_pro_bookings_oa_work_ext_booking_key" ON "uzu_pro_bookings"("oa_id", "work_id", "external_booking_id");

-- CreateIndex
CREATE INDEX "uzu_pro_players_oa_id_idx" ON "uzu_pro_players"("oa_id");

-- CreateIndex
CREATE INDEX "uzu_pro_players_booking_id_idx" ON "uzu_pro_players"("booking_id");

-- CreateIndex
CREATE INDEX "uzu_pro_players_status_idx" ON "uzu_pro_players"("status");

-- CreateIndex
CREATE UNIQUE INDEX "uzu_pro_players_booking_index_key" ON "uzu_pro_players"("booking_id", "player_index");

-- CreateIndex
CREATE UNIQUE INDEX "uzu_pro_players_oa_ext_ticket_key" ON "uzu_pro_players"("oa_id", "external_ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "uzu_pro_liff_links_token_hash_key" ON "uzu_pro_liff_links"("token_hash");

-- CreateIndex
CREATE INDEX "uzu_pro_liff_links_player_id_status_idx" ON "uzu_pro_liff_links"("player_id", "status");

-- CreateIndex
CREATE INDEX "uzu_pro_liff_links_oa_id_idx" ON "uzu_pro_liff_links"("oa_id");

-- CreateIndex
CREATE UNIQUE INDEX "uzu_pro_sync_requests_idempotency_key_key" ON "uzu_pro_sync_requests"("idempotency_key");

-- CreateIndex
CREATE INDEX "uzu_pro_sync_requests_oa_id_work_id_idx" ON "uzu_pro_sync_requests"("oa_id", "work_id");

-- CreateIndex
CREATE INDEX "uzu_pro_sync_requests_status_idx" ON "uzu_pro_sync_requests"("status");

-- CreateIndex
CREATE INDEX "uzu_pro_activity_logs_oa_id_work_id_created_at_idx" ON "uzu_pro_activity_logs"("oa_id", "work_id", "created_at");

-- CreateIndex
CREATE INDEX "uzu_pro_activity_logs_action_created_at_idx" ON "uzu_pro_activity_logs"("action", "created_at");

-- AddForeignKey
ALTER TABLE "uzu_pro_bookings" ADD CONSTRAINT "uzu_pro_bookings_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uzu_pro_bookings" ADD CONSTRAINT "uzu_pro_bookings_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uzu_pro_bookings" ADD CONSTRAINT "uzu_pro_bookings_live_session_id_fkey" FOREIGN KEY ("live_session_id") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uzu_pro_players" ADD CONSTRAINT "uzu_pro_players_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uzu_pro_players" ADD CONSTRAINT "uzu_pro_players_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "uzu_pro_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uzu_pro_liff_links" ADD CONSTRAINT "uzu_pro_liff_links_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uzu_pro_liff_links" ADD CONSTRAINT "uzu_pro_liff_links_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "uzu_pro_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 1 プレイヤー 1 有効(issued)リンクを DB レベルで保証する部分 UNIQUE INDEX（Prisma schema では表現不可）。
-- 失効(revoked)/連携(linked)/失敗(error)は複数履歴可、issued は各 player 最大 1 行。
CREATE UNIQUE INDEX "uzu_pro_liff_links_one_active_per_player" ON "uzu_pro_liff_links"("player_id") WHERE "status" = 'issued';
