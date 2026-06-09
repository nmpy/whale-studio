-- Oa の LIFF 設定（OA 単位）を追加する。
-- すべて optional / default 付きの additive な ADD COLUMN のみ。
-- 既存行は liff_id / liff_endpoint_url = NULL、liff_scan_qr_enabled = false で埋まり、
-- 既存挙動（NEXT_PUBLIC_LIFF_ID フォールバック）は変わらない（non-breaking）。
ALTER TABLE "oas" ADD COLUMN "liff_id" TEXT;
ALTER TABLE "oas" ADD COLUMN "liff_endpoint_url" TEXT;
ALTER TABLE "oas" ADD COLUMN "liff_scan_qr_enabled" BOOLEAN NOT NULL DEFAULT false;
