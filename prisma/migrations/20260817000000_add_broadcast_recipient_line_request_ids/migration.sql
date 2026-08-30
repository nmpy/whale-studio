-- 配信メッセージの observability 拡張: LINE 送信リクエスト識別子の永続化。
--
-- 背景:
--   Push API が HTTP 200 を返したのに実端末で受信されないケースが発生した際、
--   LINE 側へ問い合わせるための識別子（x-line-request-id）を Whale 側に残していなかったため、
--   accepted と delivery の間を追跡できなかった。
--
-- **additive のみ**。既存カラム / インデックス / データへの破壊的変更・backfill は行わない。
--   追加列はいずれも nullable（既存行は NULL のまま。送信ロジック・集計・retry 挙動は不変）。

-- 成功時（2xx）に LINE が返す x-line-request-id
ALTER TABLE "broadcast_recipients" ADD COLUMN IF NOT EXISTS "line_request_id" TEXT;

-- retry key 衝突（409）時に LINE が返す x-line-accepted-request-id
ALTER TABLE "broadcast_recipients" ADD COLUMN IF NOT EXISTS "line_accepted_request_id" TEXT;
