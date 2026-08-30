-- for UZU Pro: LINE User ID の連携元（LIFF 自動 / MANUAL 手動）を区別する列を追加する。
-- additive・非破壊: enum 型追加 + nullable 列追加 + 既存連携の後方互換 backfill のみ。
-- 用途: LIFF 経由の自動紐づけ（PR #594）と、管理画面からの手動登録（緊急運用）を監査・UI で識別する。
-- 適用: 通常運用どおり prisma migrate deploy（Prisma の migration 履歴で一度だけ適用）。

-- CreateEnum
CREATE TYPE "UzuProLineLinkSource" AS ENUM ('LIFF', 'MANUAL');

-- AlterTable: 未連携は null。新規連携時に LIFF / MANUAL を設定する。
ALTER TABLE "uzu_pro_players" ADD COLUMN     "line_link_source" "UzuProLineLinkSource";

-- Backfill: 既存の LINE 連携はすべて LIFF 経由（手動登録は本 migration で新設）。
-- 手動登録は今後のみ MANUAL を記録するため、既存の連携済み行は LIFF として整合させる。
UPDATE "uzu_pro_players" SET "line_link_source" = 'LIFF' WHERE "line_user_id" IS NOT NULL;
