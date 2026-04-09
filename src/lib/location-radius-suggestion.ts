// src/lib/location-radius-suggestion.ts
// Location ごとの半径見直し提案ロジック。
//
// out_of_range 試行の distance_meters 分布をもとに、
// 現在の半径を少し広げることで成功率が改善しそうかを判定する。
//
// ■ ロジック:
//   1. out_of_range で distance_meters が入っている試行を収集
//   2. 現在半径の 2倍以内に収まる「近距離失敗」だけを対象にする
//      （極端に遠い外れ値は除外）
//   3. 近距離失敗の 75th percentile を推奨半径候補にする
//   4. 10m 単位に切り上げてキリ良くする
//   5. 安全性条件を適用
//
// ■ 定数（調整可能）:

/** 提案に必要な最小 out_of_range サンプル数 */
export const MIN_SAMPLES = 3;

/** 提案半径の上限（m） */
export const MAX_SUGGESTED_RADIUS = 300;

/** 現在半径との最小差分（これ未満なら提案しない） */
export const MIN_RADIUS_DELTA = 10;

/** out_of_range の距離が 現在半径 × この倍率 以内のものだけ「近距離失敗」とみなす */
const NEAR_MISS_MULTIPLIER = 2.0;

/** percentile（0〜1）。0.75 = 75th percentile */
const TARGET_PERCENTILE = 0.75;

/** 切り上げ単位（m） */
const ROUND_UP_UNIT = 10;

export interface RadiusSuggestion {
  current_radius: number;
  suggested_radius: number;
  reason: string;
  confidence: "high" | "medium" | "low";
  sample_count: number;
  near_miss_count: number;
}

/**
 * out_of_range 距離データから半径見直し提案を計算する。
 * 提案できない場合は null。
 */
export function suggestRadius(
  currentRadius: number,
  outOfRangeDistances: number[],
): RadiusSuggestion | null {
  // サンプル数不足
  if (outOfRangeDistances.length < MIN_SAMPLES) return null;

  // 近距離失敗のみ抽出（極端に遠い外れ値を除外）
  const nearMissThreshold = currentRadius * NEAR_MISS_MULTIPLIER;
  const nearMisses = outOfRangeDistances
    .filter((d) => d <= nearMissThreshold)
    .sort((a, b) => a - b);

  // 近距離失敗が MIN_SAMPLES 未満なら提案しない
  if (nearMisses.length < MIN_SAMPLES) return null;

  // 75th percentile を算出
  const p75Index = Math.ceil(nearMisses.length * TARGET_PERCENTILE) - 1;
  const p75 = nearMisses[Math.min(p75Index, nearMisses.length - 1)];

  // 10m 単位に切り上げ + バッファ
  const rawSuggested = Math.ceil(p75 / ROUND_UP_UNIT) * ROUND_UP_UNIT;

  // 安全性チェック
  if (rawSuggested <= currentRadius + MIN_RADIUS_DELTA) return null;
  if (rawSuggested > MAX_SUGGESTED_RADIUS) return null;

  // 信頼度判定
  const confidence: "high" | "medium" | "low" =
    nearMisses.length >= 10 ? "high" :
    nearMisses.length >= 5 ? "medium" : "low";

  return {
    current_radius: currentRadius,
    suggested_radius: rawSuggested,
    reason: `範囲外の ${nearMisses.length} 件中 75% が ${rawSuggested}m 以内で発生しています`,
    confidence,
    sample_count: outOfRangeDistances.length,
    near_miss_count: nearMisses.length,
  };
}
