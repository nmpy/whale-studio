-- Work に「開始方法」カラムを追加。
--   keyword   = 既定（従来の startKeyword / 開始フェーズ startTrigger による開始）
--   free_text = 進行中 progress の無いプレイヤーの任意テキストで開始
-- 既存行はすべて DEFAULT 'keyword' で完全後方互換（NOT NULL・ゼロダウンタイムな ADD COLUMN）。
ALTER TABLE "works" ADD COLUMN "start_trigger_mode" TEXT NOT NULL DEFAULT 'keyword';
