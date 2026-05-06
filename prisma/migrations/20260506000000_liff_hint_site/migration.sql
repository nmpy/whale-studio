-- AlterTable: liff_page_configs にヒントサイト用カラムを追加
ALTER TABLE "liff_page_configs"
  ADD COLUMN "page_type"       TEXT  NOT NULL DEFAULT 'default',
  ADD COLUMN "publish_status"  TEXT  NOT NULL DEFAULT 'draft',
  ADD COLUMN "settings_json"   JSONB NOT NULL DEFAULT '{}';

-- 既存レコードを is_enabled に合わせて publish_status を補正する
-- （既に有効な LIFF はそのまま published として扱う）
UPDATE "liff_page_configs"
   SET "publish_status" = 'published'
 WHERE "is_enabled" = TRUE;

-- CreateIndex
CREATE INDEX "liff_page_configs_page_type_idx"      ON "liff_page_configs"("page_type");
CREATE INDEX "liff_page_configs_publish_status_idx" ON "liff_page_configs"("publish_status");
