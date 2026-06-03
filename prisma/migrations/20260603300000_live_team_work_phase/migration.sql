-- Phase 2-G: LiveTeam 新規 + LiveSession.workId + LiveParticipant に teamId / reservationNumber / currentPhaseId 追加

-- AlterTable: LiveSession に workId
ALTER TABLE "live_sessions" ADD COLUMN "work_id" TEXT;

-- CreateIndex
CREATE INDEX "live_sessions_work_id_idx" ON "live_sessions"("work_id");

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: live_teams
CREATE TABLE "live_teams" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "live_session_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reservation_number" TEXT,
    "memo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_teams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_teams_live_session_id_created_at_idx" ON "live_teams"("live_session_id", "created_at");

-- CreateIndex
CREATE INDEX "live_teams_live_session_id_reservation_number_idx" ON "live_teams"("live_session_id", "reservation_number");

-- CreateIndex
CREATE INDEX "live_teams_oa_id_idx" ON "live_teams"("oa_id");

-- AddForeignKey
ALTER TABLE "live_teams" ADD CONSTRAINT "live_teams_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_teams" ADD CONSTRAINT "live_teams_live_session_id_fkey" FOREIGN KEY ("live_session_id") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: LiveParticipant に teamId / reservationNumber / currentPhaseId
ALTER TABLE "live_participants" ADD COLUMN "team_id" TEXT;
ALTER TABLE "live_participants" ADD COLUMN "current_phase_id" TEXT;
ALTER TABLE "live_participants" ADD COLUMN "reservation_number" TEXT;

-- CreateIndex
CREATE INDEX "live_participants_live_session_id_team_id_idx" ON "live_participants"("live_session_id", "team_id");

-- CreateIndex
CREATE INDEX "live_participants_live_session_id_reservation_number_idx" ON "live_participants"("live_session_id", "reservation_number");

-- AddForeignKey
ALTER TABLE "live_participants" ADD CONSTRAINT "live_participants_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "live_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_participants" ADD CONSTRAINT "live_participants_current_phase_id_fkey" FOREIGN KEY ("current_phase_id") REFERENCES "phases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
