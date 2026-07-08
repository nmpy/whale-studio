-- LiveEventType に staff_phase_move を追加（PR4-1）。
-- スタッフが実 UserProgress のフェーズを移動した操作ログの専用イベント種別。
-- PostgreSQL 12+ では ALTER TYPE ... ADD VALUE は単独実行でオンライン適用可（Supabase=PG15+）。
-- 既存値は不変・後方互換。
ALTER TYPE "LiveEventType" ADD VALUE IF NOT EXISTS 'staff_phase_move';
