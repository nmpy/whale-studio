/**
 * X Analytics データ取得サービス
 *
 * 全コンポーネントはここ経由でデータを取得する。
 * データ種別ごとに関数を分離しているので、種別ごとに差し替えが可能。
 *
 * ─────────────────────────────────────────────────────────
 * 差し替えポイント一覧
 *
 * ① getProfile()     固定データ。変更時は lib/mock/x-account.ts を編集。
 *
 * ② getManualStats() 手動更新データ。
 *                    将来: X API v2 または X アーカイブのメタ情報で自動化。
 *
 * ③ getAutoData()    将来自動化データ（現在はモック）。
 *                    Step1: lib/importers/x-archive.ts を実装して差し替え。
 *                    Step2: X API v2 に差し替え。
 * ─────────────────────────────────────────────────────────
 */

import type { XProfile, XManualStats, XDashboardData } from '@/lib/types/x';
import { X_PROFILE, X_MANUAL_STATS } from '@/lib/mock/x-account';
import { getMockFollowerHistory, getMockDailyEngagement, getMockPosts } from '@/lib/mock/x-posts';

// ─────────────────────────────────────────────────────────
// ① 固定データ（同期・即時返却）
// ─────────────────────────────────────────────────────────

/**
 * アカウント基本情報を返す（同期）
 * 差し替え不要。変更時は lib/mock/x-account.ts の X_PROFILE を直接編集。
 */
export function getProfile(): XProfile {
  return X_PROFILE;
}

// ─────────────────────────────────────────────────────────
// ② 手動更新データ（同期・即時返却）
// ─────────────────────────────────────────────────────────

/**
 * 手動管理の統計情報を返す（同期）
 * 定期的に lib/mock/x-account.ts の X_MANUAL_STATS を書き換えて更新する。
 * TODO: 将来は X API v2 または X アーカイブのメタ情報で自動化
 */
export function getManualStats(): XManualStats {
  return X_MANUAL_STATS;
  // 将来の差し替えイメージ:
  // return await fetchStatsFromXApi();
  // return parseStatsFromArchive(archiveData);
}

// ─────────────────────────────────────────────────────────
// ③ 将来自動化データ（非同期・ローディングあり）
// ─────────────────────────────────────────────────────────

/**
 * グラフ・投稿データを返す（非同期）
 * 現在はモックデータを返す。
 * TODO: Step1 → lib/importers/x-archive.ts 実装後に差し替え
 *       Step2 → X API v2 fetch に差し替え
 */
export async function getAutoData() {
  // モック: 軽いロード感を演出（本番では削除）
  await new Promise(r => setTimeout(r, 500));

  return {
    followerHistory: getMockFollowerHistory(),
    dailyEngagement: getMockDailyEngagement(),
    posts:           getMockPosts(),
  };
  // 将来の差し替えイメージ:
  // const { posts, dailyStats } = await importFromXArchive(file);
  // return { followerHistory: dailyStats, dailyEngagement: dailyStats, posts };
}

// ─────────────────────────────────────────────────────────
// ダッシュボード全データ（① + ② + ③ をまとめて取得）
// ─────────────────────────────────────────────────────────

export async function fetchDashboardData(): Promise<XDashboardData> {
  const autoData = await getAutoData();
  return {
    profile: getProfile(),
    stats:   getManualStats(),
    ...autoData,
  };
}
