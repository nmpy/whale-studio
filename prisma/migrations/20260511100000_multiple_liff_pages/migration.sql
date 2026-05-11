-- 複数 LIFF ページ対応: liff_page_configs の work_id ユニーク制約を撤廃し、
-- work あたり複数の LIFF ページを保持できるようにする。
--
-- 既存レコードはそのまま残り、各 work の「最初の (oldest) ページ」として扱う。
-- データ移行は不要。
--
-- - 旧: liff_page_configs(work_id) UNIQUE
-- - 新: liff_page_configs(work_id) インデックスのみ
DROP INDEX IF EXISTS "liff_page_configs_work_id_key";
CREATE INDEX IF NOT EXISTS "liff_page_configs_work_id_idx" ON "liff_page_configs"("work_id");
