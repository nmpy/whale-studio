-- Oa に「運用モード」カラムを追加。
--   messaging = 配信（お知らせ/予約/テスト配信）
--   content   = LINE上で進行する謎解き/マダミス/体験型（既定・従来の studio 用途）
--   live      = 現地公演運営（Operation Belkish 等。for Admin/Staff/Player 導線を前面化）
-- 既存行はすべて DEFAULT 'content' で完全後方互換（NOT NULL・ゼロダウンタイムな ADD COLUMN）。
-- Live 実体（sessions/actors 等）へのアクセスは従来どおり OaEntitlement("whale_studio_live")/
-- canAccessLive で保護され、mode は導線/ランディングの出し分けにのみ使う（加算的サーフェス）。
ALTER TABLE "oas" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'content';
