-- CreateEnum
CREATE TYPE "LiveSessionStatus" AS ENUM ('draft', 'active', 'ended');

-- CreateEnum
CREATE TYPE "LiveParticipantStatus" AS ENUM ('waiting', 'active', 'stuck', 'completed', 'dropped');

-- CreateEnum
CREATE TYPE "LiveEventType" AS ENUM ('qr_scanned', 'checked_in', 'puzzle_solved', 'message_sent', 'actor_contacted', 'note_added', 'alert');

-- CreateTable
CREATE TABLE "live_sessions" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "LiveSessionStatus" NOT NULL DEFAULT 'draft',
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_sessions_oa_id_created_at_idx" ON "live_sessions"("oa_id", "created_at");

-- CreateIndex
CREATE INDEX "live_sessions_oa_id_status_idx" ON "live_sessions"("oa_id", "status");

-- CreateTable
CREATE TABLE "live_participants" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "live_session_id" TEXT NOT NULL,
    "display_name" TEXT,
    "line_user_id" TEXT,
    "status" "LiveParticipantStatus" NOT NULL DEFAULT 'waiting',
    "current_step" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_participants_live_session_id_created_at_idx" ON "live_participants"("live_session_id", "created_at");

-- CreateIndex
CREATE INDEX "live_participants_live_session_id_status_idx" ON "live_participants"("live_session_id", "status");

-- CreateIndex
CREATE INDEX "live_participants_oa_id_idx" ON "live_participants"("oa_id");

-- CreateTable
CREATE TABLE "live_event_logs" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "live_session_id" TEXT,
    "participant_id" TEXT,
    "type" "LiveEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_event_logs_live_session_id_created_at_idx" ON "live_event_logs"("live_session_id", "created_at");

-- CreateIndex
CREATE INDEX "live_event_logs_participant_id_created_at_idx" ON "live_event_logs"("participant_id", "created_at");

-- CreateIndex
CREATE INDEX "live_event_logs_oa_id_created_at_idx" ON "live_event_logs"("oa_id", "created_at");

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_participants" ADD CONSTRAINT "live_participants_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_participants" ADD CONSTRAINT "live_participants_live_session_id_fkey" FOREIGN KEY ("live_session_id") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_event_logs" ADD CONSTRAINT "live_event_logs_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_event_logs" ADD CONSTRAINT "live_event_logs_live_session_id_fkey" FOREIGN KEY ("live_session_id") REFERENCES "live_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_event_logs" ADD CONSTRAINT "live_event_logs_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "live_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
