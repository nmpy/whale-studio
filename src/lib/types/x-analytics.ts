/**
 * 後方互換 re-export
 * 新規コードは lib/types/x.ts を使用してください。
 */
export type {
  XProfile as XAccount,
  XManualStats as AccountStats,
  XFollowerPoint as FollowerDataPoint,
  XDailyEngagement as DailyEngagement,
  XPost as Post,
  PostSortKey,
  XDashboardData as DashboardData,
} from './x';
