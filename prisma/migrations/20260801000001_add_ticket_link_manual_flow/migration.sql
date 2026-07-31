-- 手動登録フロー（PR2）のための additive 拡張。
-- 既存行・既存列は変更しない（追加列はすべて nullable / 新規 index のみ）。

-- CreateEnum: 手動登録フローのステップ（status とは別軸。順序強制に使う）
CREATE TYPE "TicketLinkDraftStep" AS ENUM ('MANUAL_INPUT', 'TICKET_REVIEW', 'CODE_NAMES', 'FINAL_REVIEW');

-- AlterTable: ドラフトへ進捗ステップを追加（null = 画像/テキスト経路。PR4 で使用）
ALTER TABLE "ticket_link_drafts" ADD COLUMN "step" "TicketLinkDraftStep";

-- AlterTable: 確定時スナップショット。
--   設定側のチケット種別ラベル・人数を後から変更/削除しても、登録済みの表示が変わらないようにする。
--   ticket_type は既存列を「確定時ラベルのスナップショット」として使い続ける（意味づけのみ変更）。
ALTER TABLE "ticket_links" ADD COLUMN "ticket_type_key" TEXT;

-- CreateIndex: 手動フローのドラフト検索（OA + LINE ユーザー + ステップ）
CREATE INDEX "ticket_link_drafts_oa_id_line_user_id_step_idx"
  ON "ticket_link_drafts"("oa_id", "line_user_id", "step");

-- 競合レコードの無制限増加を防ぐ部分 UNIQUE。
--   別 LINE ユーザーが同じ予約番号を再試行しても、
--   (OA, 作品, 正規化予約番号, 登録を試みた LINE userId) につき CONFLICT は 1 行に収束する。
--   再試行時は既存の競合結果をそのまま返す（新規行を作らない）。
CREATE UNIQUE INDEX "ticket_links_conflict_attempt_key"
  ON "ticket_links"("oa_id", "work_id", "normalized_reservation_number", "line_user_id")
  WHERE "status" = 'CONFLICT';
