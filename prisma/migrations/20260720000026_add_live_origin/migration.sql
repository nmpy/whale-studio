-- Live 実行レコードのプロダクト境界 origin（NATIVE / UZU_PRO）を明示保存するための追加的・後方互換マイグレーション。
-- LIVE for Whale Studio（NATIVE）と for UZU Pro（UZU_PRO）を、externalSessionRef 等の有無で推測せず origin 列で分離する。
--
-- 追加のみ（列削除 / rename / 型変更 / 破壊的操作なし）。
-- `NOT NULL DEFAULT 'NATIVE'`: enum default は非 volatile のため ADD COLUMN はメタデータのみ（table rewrite なし）。
-- 既存全行は 'NATIVE' になる（backfill 句不要）。UZU_PRO 由来レコードは external v2 API 経由の新規作成時に付与する。
-- ※適用前に対象環境へ UZU_PRO 由来レコードが存在しないことを確認済み（PR #591 未マージ・staging 0 件）。

-- CreateEnum
CREATE TYPE "LiveOrigin" AS ENUM ('NATIVE', 'UZU_PRO');

-- AlterTable
ALTER TABLE "live_ticket_link_tokens" ADD COLUMN     "origin" "LiveOrigin" NOT NULL DEFAULT 'NATIVE';

-- AlterTable
ALTER TABLE "live_sessions" ADD COLUMN     "origin" "LiveOrigin" NOT NULL DEFAULT 'NATIVE';

-- AlterTable
ALTER TABLE "live_participants" ADD COLUMN     "origin" "LiveOrigin" NOT NULL DEFAULT 'NATIVE';

-- AlterTable
ALTER TABLE "live_teams" ADD COLUMN     "origin" "LiveOrigin" NOT NULL DEFAULT 'NATIVE';
