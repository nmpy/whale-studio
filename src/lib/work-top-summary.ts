// src/lib/work-top-summary.ts
// 作品トップ「プレイヤー状況（簡易オーディエンス）」用の純ロジック。
// 集計定義は既存の works list API / オーディエンスと同一に揃える（作品トップ独自定義にしない）:
//   - total:      このworkのプレイヤー総数（isPreview=false）
//   - completed:  reachedEnding=true（エンディング到達 / 完了）
//   - inProgress: reachedEnding=false（進行中）
//   - incomplete: total - completed（未完了）。※このデータモデルでは inProgress と同値。
// workId スコープはサーバ側集計（progress_stats）で担保する（他作品/OA を混ぜない）。

export interface WorkProgressStatsLite {
  total?:       number | null;
  completed?:   number | null;
  in_progress?: number | null;
}

export interface PlayerSummary {
  total:      number;
  completed:  number;
  inProgress: number;
  /** 未完了 = total - completed（= 進行中と同値） */
  incomplete: number;
  isEmpty:    boolean;
}

export function computePlayerSummary(stats: WorkProgressStatsLite | null | undefined): PlayerSummary {
  const total      = Math.max(0, stats?.total ?? 0);
  const completed  = Math.max(0, stats?.completed ?? 0);
  const inProgress = Math.max(0, stats?.in_progress ?? Math.max(0, total - completed));
  const incomplete = Math.max(0, total - completed);
  return { total, completed, inProgress, incomplete, isEmpty: total === 0 };
}
