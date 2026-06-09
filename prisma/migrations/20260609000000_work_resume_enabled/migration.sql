-- Work.resumeEnabled: 途中再開機能の有効/無効（作品単位のデフォルト挙動）。
-- 既存挙動（常に再開選択肢を表示）を壊さないため default true。
-- 既存行も DEFAULT true で埋まるため、データ・挙動に影響しない（additive, non-breaking）。
ALTER TABLE "works" ADD COLUMN "resume_enabled" BOOLEAN NOT NULL DEFAULT true;
