-- Short public ID columns for Work / LiffPageConfig / Location.
--
-- 目的:
--   公開 URL (LIFF / チェックイン) で UUID (36 文字) ではなく 10 文字の短縮 ID を使えるようにする。
--   DB 主キーや FK は引き続き UUID を使用し、URL に出す値だけ短縮する。
--
-- 仕様:
--   - 10 文字、英小文字 + 数字 (a-z, 0-9)
--   - 衝突時は再生成 (PL/pgSQL のループで担保)
--   - 既存レコードは migration 内で backfill
--   - 新規レコードは @default(dbgenerated(...)) で自動生成
--
-- 安全性:
--   - 既存の UUID `id` は変更しない
--   - 新カラム public_id は NOT NULL + UNIQUE
--   - 既存データ backfill 完了後に NOT NULL を有効化する段階的構造

-- ── 共通: 短縮 ID 生成関数 ─────────────────────────────
-- 与えられたテーブルに対して衝突しない 10 文字の short id を返す。
-- alphabet: a-z + 0-9 (合計 36 文字)。10 文字で 36^10 ≈ 3.6e15 通り。
CREATE OR REPLACE FUNCTION gen_unique_public_id(target_table TEXT) RETURNS TEXT AS $$
DECLARE
  candidate    TEXT;
  alphabet     TEXT := 'abcdefghijklmnopqrstuvwxyz0123456789';
  exists_count INT;
  i            INT;
  rnd_bytes    BYTEA;
BEGIN
  LOOP
    -- 10 文字をランダムに組み立てる
    candidate := '';
    rnd_bytes := gen_random_bytes(10);
    FOR i IN 0..9 LOOP
      candidate := candidate || SUBSTRING(alphabet, (get_byte(rnd_bytes, i) % 36) + 1, 1);
    END LOOP;

    -- 対象テーブルに既存値が無いか確認 (動的 SQL)
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE public_id = $1', target_table)
      INTO exists_count
      USING candidate;
    EXIT WHEN exists_count = 0;
  END LOOP;
  RETURN candidate;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- ── works ─────────────────────────────────────────────
ALTER TABLE "works" ADD COLUMN "public_id" TEXT;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM works WHERE public_id IS NULL LOOP
    UPDATE works SET public_id = gen_unique_public_id('works') WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE "works" ALTER COLUMN "public_id" SET NOT NULL;
ALTER TABLE "works" ALTER COLUMN "public_id" SET DEFAULT gen_unique_public_id('works');
CREATE UNIQUE INDEX "works_public_id_key" ON "works"("public_id");

-- ── liff_page_configs ──────────────────────────────────
ALTER TABLE "liff_page_configs" ADD COLUMN "public_id" TEXT;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM liff_page_configs WHERE public_id IS NULL LOOP
    UPDATE liff_page_configs SET public_id = gen_unique_public_id('liff_page_configs') WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE "liff_page_configs" ALTER COLUMN "public_id" SET NOT NULL;
ALTER TABLE "liff_page_configs" ALTER COLUMN "public_id" SET DEFAULT gen_unique_public_id('liff_page_configs');
CREATE UNIQUE INDEX "liff_page_configs_public_id_key" ON "liff_page_configs"("public_id");

-- ── locations ──────────────────────────────────────────
ALTER TABLE "locations" ADD COLUMN "public_id" TEXT;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM locations WHERE public_id IS NULL LOOP
    UPDATE locations SET public_id = gen_unique_public_id('locations') WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE "locations" ALTER COLUMN "public_id" SET NOT NULL;
ALTER TABLE "locations" ALTER COLUMN "public_id" SET DEFAULT gen_unique_public_id('locations');
CREATE UNIQUE INDEX "locations_public_id_key" ON "locations"("public_id");
