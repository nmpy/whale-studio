-- AlterEnum
-- LiveRole に live_owner を追加（Live 全体にアクセスできる liveRole）。
-- ALTER TYPE ... ADD VALUE は値の追加のみ。既存値・既存行に影響しない。
ALTER TYPE "LiveRole" ADD VALUE 'live_owner';
