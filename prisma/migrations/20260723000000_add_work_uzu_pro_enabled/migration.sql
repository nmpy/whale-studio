-- 作品単位の for UZU Pro 有効化フラグ Work.uzuProEnabled を追加する。
-- additive・非破壊: 列追加のみ。既存作品は default false、既存データ・既存列は変更しない。
-- 用途: for UZU Pro のアクセス条件（Work有効化 ∧ UzuProGrant ∧ active member）の (1) に使用する。
-- 適用: 通常運用どおり prisma migrate deploy（Prisma の migration 履歴で一度だけ適用）。

-- AlterTable
ALTER TABLE "works" ADD COLUMN     "uzu_pro_enabled" BOOLEAN NOT NULL DEFAULT false;

