/**
 * 後方互換 re-export
 * 新規コードは lib/mock/x-account.ts / lib/mock/x-posts.ts を使用してください。
 */
export { X_PROFILE as TARGET_ACCOUNT } from './x-account';

import type { XDashboardData } from '@/lib/types/x';
import { X_PROFILE, X_MANUAL_STATS } from './x-account';
import { getMockFollowerHistory, getMockDailyEngagement, getMockPosts } from './x-posts';

export function getMockDashboardData(): XDashboardData {
  return {
    profile:          X_PROFILE,
    stats:            X_MANUAL_STATS,
    followerHistory:  getMockFollowerHistory(),
    dailyEngagement:  getMockDailyEngagement(),
    posts:            getMockPosts(),
  };
}
