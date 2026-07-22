-- 作品単位の for UZU Pro 有効化フラグ。additive・非破壊（既存作品は false / 既存データ不変）。
-- 本番/共有/staging DB へは適用しない（Draft PR。ローカル使い捨て DB のみで検証）。

-- AlterTable
ALTER TABLE "works" ADD COLUMN     "uzu_pro_enabled" BOOLEAN NOT NULL DEFAULT false;

