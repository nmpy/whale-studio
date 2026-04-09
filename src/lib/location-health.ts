// src/lib/location-health.ts
// ロケーションの GPS 設定健全性を判定するヘルパー。
// Audience 画面で「改善が必要な地点」を分かりやすく表示するために使用。
//
// ■ 判定ルール:
//   GPS 試行 0 件 → 判定なし (null)
//   GPS 試行 < MIN_ATTEMPTS → "insufficient_data"（試行数不足・判定保留）
//   GPS 成功率 >= 80% → "good"
//   GPS 成功率 50〜79.9% → "review"
//   GPS 成功率 < 50% → "adjust"
//   out_of_range 比率 > 50% のとき、1段階引き上げ（good→review, review→adjust）

/** GPS 設定の健全性 */
export type GpsHealthStatus = "good" | "review" | "adjust" | "insufficient_data";

/** 判定に必要な最小試行数 */
const MIN_ATTEMPTS = 3;

export interface GpsHealthInput {
  gps_attempts: number;
  gps_successes: number;
  gps_success_rate: number | null;
  out_of_range_count: number;
}

export interface GpsHealthResult {
  status: GpsHealthStatus | null;
  label: string;
  color: string;
  bgColor: string;
  hint: string | null;
}

/**
 * ロケーションの GPS 設定健全性を判定する。
 * GPS 試行がない場合は null を返す。
 */
export function evaluateGpsHealth(input: GpsHealthInput): GpsHealthResult {
  if (input.gps_attempts === 0) {
    return { status: null, label: "", color: "", bgColor: "", hint: null };
  }

  if (input.gps_attempts < MIN_ATTEMPTS) {
    return {
      status: "insufficient_data",
      label: "データ不足",
      color: "#6b7280",
      bgColor: "#f3f4f6",
      hint: "試行数が少ないため判定保留中です",
    };
  }

  const rate = input.gps_success_rate ?? 0;
  const outOfRangeRatio = input.gps_attempts > 0
    ? input.out_of_range_count / input.gps_attempts
    : 0;

  let status: GpsHealthStatus;
  if (rate >= 80) status = "good";
  else if (rate >= 50) status = "review";
  else status = "adjust";

  // out_of_range が多い場合は 1 段階引き上げ
  if (outOfRangeRatio > 0.5 && status === "good") status = "review";
  if (outOfRangeRatio > 0.5 && status === "review") status = "adjust";

  const meta: Record<GpsHealthStatus, { label: string; color: string; bgColor: string }> = {
    good:   { label: "良好",   color: "#16a34a", bgColor: "#dcfce7" },
    review: { label: "要確認", color: "#d97706", bgColor: "#fef3c7" },
    adjust: { label: "要調整", color: "#dc2626", bgColor: "#fef2f2" },
    insufficient_data: { label: "データ不足", color: "#6b7280", bgColor: "#f3f4f6" },
  };

  const m = meta[status];

  // 改善ヒント
  let hint: string | null = null;
  if (status === "adjust" || status === "review") {
    if (outOfRangeRatio > 0.3) {
      hint = "範囲外が多いです。半径が狭すぎるか、ピン位置がずれている可能性があります。地図で座標を確認してください。";
    } else if (rate < 50) {
      hint = "成功率が低いです。GPS 設定（座標・半径）を見直してください。";
    } else {
      hint = "成功率がやや低めです。半径を広げることを検討してください。";
    }
  }

  return { status, ...m, hint };
}
