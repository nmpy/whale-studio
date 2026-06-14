-- プレイヤーへの「謎・問題の出題履歴」を保存する新規テーブル。
-- 新規テーブルのみ（additive）。適用前の現行コードはこのテーブルを参照しないため本番無停止で先行適用できる。
-- 既存ユーザー・既存データには影響しない（初期は空）。正解状態は UserProgress.flags.solvedPuzzles から導出する。
CREATE TABLE "puzzle_deliveries" (
    "id" TEXT NOT NULL,
    "line_user_id" TEXT NOT NULL,
    "work_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "delivered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "puzzle_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "puzzle_deliveries_line_user_id_work_id_message_id_key" ON "puzzle_deliveries"("line_user_id", "work_id", "message_id");
CREATE INDEX "puzzle_deliveries_line_user_id_work_id_idx" ON "puzzle_deliveries"("line_user_id", "work_id");
CREATE INDEX "puzzle_deliveries_message_id_idx" ON "puzzle_deliveries"("message_id");

ALTER TABLE "puzzle_deliveries" ADD CONSTRAINT "puzzle_deliveries_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "works"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "puzzle_deliveries" ADD CONSTRAINT "puzzle_deliveries_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
