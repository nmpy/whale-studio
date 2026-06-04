-- Phase 2-I: LiveScript / LiveCue 新規追加

-- CreateEnum
CREATE TYPE "LiveCuePriority" AS ENUM ('low', 'normal', 'high');

-- CreateTable: live_scripts
CREATE TABLE "live_scripts" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "work_id" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "memo" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_scripts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_scripts_oa_id_work_id_is_active_idx" ON "live_scripts"("oa_id", "work_id", "is_active");

-- CreateIndex
CREATE INDEX "live_scripts_oa_id_created_at_idx" ON "live_scripts"("oa_id", "created_at");

-- AddForeignKey
ALTER TABLE "live_scripts" ADD CONSTRAINT "live_scripts_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_scripts" ADD CONSTRAINT "live_scripts_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: live_cues
CREATE TABLE "live_cues" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "work_id" TEXT,
    "phase_id" TEXT,
    "actor_id" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "priority" "LiveCuePriority" NOT NULL DEFAULT 'normal',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_cues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_cues_oa_id_work_id_is_active_idx" ON "live_cues"("oa_id", "work_id", "is_active");

-- CreateIndex
CREATE INDEX "live_cues_work_id_phase_id_is_active_idx" ON "live_cues"("work_id", "phase_id", "is_active");

-- CreateIndex
CREATE INDEX "live_cues_work_id_actor_id_is_active_idx" ON "live_cues"("work_id", "actor_id", "is_active");

-- CreateIndex
CREATE INDEX "live_cues_oa_id_created_at_idx" ON "live_cues"("oa_id", "created_at");

-- AddForeignKey
ALTER TABLE "live_cues" ADD CONSTRAINT "live_cues_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_cues" ADD CONSTRAINT "live_cues_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_cues" ADD CONSTRAINT "live_cues_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "phases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_cues" ADD CONSTRAINT "live_cues_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "live_actors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
