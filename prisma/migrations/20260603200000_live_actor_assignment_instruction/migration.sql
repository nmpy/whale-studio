-- CreateEnum
CREATE TYPE "LiveInstructionPriority" AS ENUM ('low', 'normal', 'high');

-- CreateEnum
CREATE TYPE "LiveInstructionStatus" AS ENUM ('active', 'done', 'archived');

-- CreateTable
CREATE TABLE "live_actors" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "user_id" TEXT,
    "character_name" TEXT,
    "memo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_actors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_actors_oa_id_created_at_idx" ON "live_actors"("oa_id", "created_at");

-- CreateIndex
CREATE INDEX "live_actors_oa_id_user_id_idx" ON "live_actors"("oa_id", "user_id");

-- CreateTable
CREATE TABLE "live_assignments" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "live_session_id" TEXT NOT NULL,
    "participant_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "live_assignments_live_session_id_participant_id_actor_id_key" ON "live_assignments"("live_session_id", "participant_id", "actor_id");

-- CreateIndex
CREATE INDEX "live_assignments_live_session_id_actor_id_idx" ON "live_assignments"("live_session_id", "actor_id");

-- CreateIndex
CREATE INDEX "live_assignments_live_session_id_participant_id_idx" ON "live_assignments"("live_session_id", "participant_id");

-- CreateIndex
CREATE INDEX "live_assignments_oa_id_idx" ON "live_assignments"("oa_id");

-- CreateTable
CREATE TABLE "live_actor_instructions" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "live_session_id" TEXT NOT NULL,
    "participant_id" TEXT,
    "actor_id" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "priority" "LiveInstructionPriority" NOT NULL DEFAULT 'normal',
    "status" "LiveInstructionStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_actor_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_actor_instructions_live_session_id_status_created_at_idx" ON "live_actor_instructions"("live_session_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "live_actor_instructions_live_session_id_actor_id_idx" ON "live_actor_instructions"("live_session_id", "actor_id");

-- CreateIndex
CREATE INDEX "live_actor_instructions_live_session_id_participant_id_idx" ON "live_actor_instructions"("live_session_id", "participant_id");

-- CreateIndex
CREATE INDEX "live_actor_instructions_oa_id_idx" ON "live_actor_instructions"("oa_id");

-- AddForeignKey
ALTER TABLE "live_actors" ADD CONSTRAINT "live_actors_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_assignments" ADD CONSTRAINT "live_assignments_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_assignments" ADD CONSTRAINT "live_assignments_live_session_id_fkey" FOREIGN KEY ("live_session_id") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_assignments" ADD CONSTRAINT "live_assignments_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "live_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_assignments" ADD CONSTRAINT "live_assignments_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "live_actors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_actor_instructions" ADD CONSTRAINT "live_actor_instructions_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_actor_instructions" ADD CONSTRAINT "live_actor_instructions_live_session_id_fkey" FOREIGN KEY ("live_session_id") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_actor_instructions" ADD CONSTRAINT "live_actor_instructions_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "live_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_actor_instructions" ADD CONSTRAINT "live_actor_instructions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "live_actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
