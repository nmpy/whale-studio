-- CreateTable: Live Mode の予約完了メール用「チケットリンクトークン」（Phase 1・加算的）。
-- 既存テーブル/カラム/index は一切変更しない。平文トークンは保存せず token_hash(sha256) のみ。
CREATE TABLE "live_ticket_link_tokens" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "reservation_number" TEXT NOT NULL,
    "ticket_id" TEXT,
    "live_session_id" TEXT,
    "team_id" TEXT,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "first_opened_at" TIMESTAMP(3),
    "first_used_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_ticket_link_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "live_ticket_link_tokens_token_hash_key" ON "live_ticket_link_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "live_ticket_link_tokens_oa_id_expires_at_idx" ON "live_ticket_link_tokens"("oa_id", "expires_at");

-- CreateIndex
CREATE INDEX "live_ticket_link_tokens_oa_id_work_id_reservation_number_idx" ON "live_ticket_link_tokens"("oa_id", "work_id", "reservation_number");

-- AddForeignKey
ALTER TABLE "live_ticket_link_tokens" ADD CONSTRAINT "live_ticket_link_tokens_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
