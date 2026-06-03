-- Phase 2-H: LiveImportPreset 新規追加 (= OA 単位で列マッピングプリセットを保存)

-- CreateTable
CREATE TABLE "live_import_presets" (
    "id" TEXT NOT NULL,
    "oa_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mapping" JSONB NOT NULL,
    "team_mode" TEXT NOT NULL,
    "duplicate_mode" TEXT NOT NULL,
    "delimiter" TEXT,
    "encoding" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_import_presets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_import_presets_oa_id_created_at_idx" ON "live_import_presets"("oa_id", "created_at");

-- AddForeignKey
ALTER TABLE "live_import_presets" ADD CONSTRAINT "live_import_presets_oa_id_fkey" FOREIGN KEY ("oa_id") REFERENCES "oas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
