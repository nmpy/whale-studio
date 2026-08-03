-- チケット連携 (Ticket Link) の基盤テーブル。
-- additive・非破壊: 新規 enum / 新規テーブル / 新規 index のみ。既存テーブル・既存行は一切変更しない。
--   個人情報: 恒久保存は line_user_id / line_display_name / code_name のみ（CMS 連携に必要な最小限）。
--   OCR 原文・購入者名等は ticket_link_drafts にのみ保持する。expires_at は期限情報であり、
--   実データの削除処理は PR4 で実装する（本 migration は土台のみ）。

-- CreateEnum
CREATE TYPE "TicketLinkStatus" AS ENUM ('PENDING_UZU_BOOKING', 'LINKED', 'CONFLICT', 'REVOKED');

-- CreateEnum
CREATE TYPE "TicketLinkDraftStatus" AS ENUM ('RECEIVED', 'EXTRACTING', 'NEEDS_REVIEW', 'CONFIRMED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TicketLinkSource" AS ENUM ('LINE_IMAGE', 'LIFF_IMAGE', 'LINE_TEXT', 'LIFF_MANUAL');

-- CreateEnum
CREATE TYPE "TicketLinkSyncResult" AS ENUM ('LINKED', 'PENDING_BOOKING', 'CONFLICT', 'NO_CHANGE', 'ERROR');

-- CreateTable
CREATE TABLE "ticket_link_drafts" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "work_id" TEXT,
    "line_user_id" TEXT NOT NULL,
    "source" "TicketLinkSource" NOT NULL,
    "source_message_id" TEXT,
    "status" "TicketLinkDraftStatus" NOT NULL DEFAULT 'RECEIVED',
    "image_storage_key" TEXT,
    "ocr_raw_text" TEXT,
    "extracted_payload" JSONB,
    "confirmed_payload" JSONB,
    "token_hash" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_link_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_links" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "line_user_id" TEXT NOT NULL,
    "line_display_name" TEXT,
    "normalized_reservation_number" TEXT NOT NULL,
    "reservation_number_raw" TEXT,
    "ticket_type" TEXT,
    "participant_count" INTEGER NOT NULL,
    "source" "TicketLinkSource" NOT NULL,
    "status" "TicketLinkStatus" NOT NULL DEFAULT 'PENDING_UZU_BOOKING',
    "confirmed_at" TIMESTAMP(3) NOT NULL,
    "uzu_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_link_members" (
    "id" TEXT NOT NULL,
    "ticket_link_id" TEXT NOT NULL,
    "member_index" INTEGER NOT NULL,
    "code_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_link_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_link_sync_logs" (
    "id" TEXT NOT NULL,
    "ticket_link_id" TEXT NOT NULL,
    "uzu_work_id" TEXT,
    "result" "TicketLinkSyncResult" NOT NULL,
    "error_code" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_link_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_link_drafts_source_message_id_key" ON "ticket_link_drafts"("source_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_link_drafts_token_hash_key" ON "ticket_link_drafts"("token_hash");

-- CreateIndex
CREATE INDEX "ticket_link_drafts_oa_id_line_user_id_status_idx" ON "ticket_link_drafts"("oa_id", "line_user_id", "status");

-- CreateIndex
CREATE INDEX "ticket_link_drafts_status_expires_at_idx" ON "ticket_link_drafts"("status", "expires_at");

-- CreateIndex
CREATE INDEX "ticket_links_oa_id_work_id_normalized_reservation_number_idx" ON "ticket_links"("oa_id", "work_id", "normalized_reservation_number");

-- CreateIndex
CREATE INDEX "ticket_links_oa_id_line_user_id_idx" ON "ticket_links"("oa_id", "line_user_id");

-- CreateIndex
CREATE INDEX "ticket_links_work_id_status_idx" ON "ticket_links"("work_id", "status");

-- CreateIndex
CREATE INDEX "ticket_links_work_id_updated_at_idx" ON "ticket_links"("work_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_link_members_link_index_key" ON "ticket_link_members"("ticket_link_id", "member_index");

-- CreateIndex
CREATE INDEX "ticket_link_members_ticket_link_id_idx" ON "ticket_link_members"("ticket_link_id");

-- CreateIndex
CREATE INDEX "ticket_link_sync_logs_ticket_link_id_synced_at_idx" ON "ticket_link_sync_logs"("ticket_link_id", "synced_at");

-- CreateIndex
CREATE INDEX "ticket_link_sync_logs_result_synced_at_idx" ON "ticket_link_sync_logs"("result", "synced_at");

-- 「有効な連携は (OA, 作品, 正規化予約番号) につき 1 件」を DB で担保する部分 UNIQUE。
-- CONFLICT / REVOKED は対象外にして併存させ、競合の事実を消さずに残す
-- （別 LINE ユーザーの同一予約番号登録は CONFLICT 行として保存でき、自動上書きは起きない）。
CREATE UNIQUE INDEX "ticket_links_active_reservation_key"
  ON "ticket_links"("oa_id", "work_id", "normalized_reservation_number")
  WHERE "status" IN ('PENDING_UZU_BOOKING', 'LINKED');

-- AddForeignKey
ALTER TABLE "ticket_link_drafts" ADD CONSTRAINT "ticket_link_drafts_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_link_drafts" ADD CONSTRAINT "ticket_link_drafts_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_link_members" ADD CONSTRAINT "ticket_link_members_ticket_link_id_fkey" FOREIGN KEY ("ticket_link_id") REFERENCES "ticket_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_link_sync_logs" ADD CONSTRAINT "ticket_link_sync_logs_ticket_link_id_fkey" FOREIGN KEY ("ticket_link_id") REFERENCES "ticket_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
