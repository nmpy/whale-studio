// src/lib/analytics-exclusion.ts
//
// 分析除外ユーザー（AnalyticsExcludedUser）を集計へ適用する純ヘルパー。
//   - 除外は OA 単位の lineUserId 集合。集計前に in-memory で除外する（元データは削除しない）。
//   - 期間フィルター / isPreview 除外とは独立して合成できる。
//   - UI 表示用の UID マスクもここに集約。

/** LINE UID を一部マスク（末尾4桁のみ表示）。 */
export function maskLineUserId(id: string): string {
  if (!id) return "U***";
  if (id.length <= 4) return "U***";
  return `U***${id.slice(-4)}`;
}

/**
 * 除外対象 lineUserId を集計対象リストから取り除く（非破壊）。
 * excluded が空なら元配列をそのまま返す。
 */
export function applyExclusion<T extends { lineUserId: string }>(list: T[], excluded: Set<string>): T[] {
  if (excluded.size === 0) return list;
  return list.filter((p) => !excluded.has(p.lineUserId));
}
