-- 作品メニューホームの任意設定（タイトル/説明文/画像）を格納する JSONB カラムを追加する。
-- 既存行は default '{}' で埋まり、アプリ側は空 {} を「未設定 = 従来表示」として扱うため挙動は変わらない。
-- 追加のみ（additive）で、適用前の現行コードはこのカラムを参照しないため本番無停止で先行適用できる。
ALTER TABLE "works" ADD COLUMN "liff_home_settings_json" JSONB NOT NULL DEFAULT '{}';
