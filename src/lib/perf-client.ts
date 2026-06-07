// src/lib/perf-client.ts
// Client-side パフォーマンス計測ヘルパー (= browser console 出力)。
//
// 方針:
//   - デフォルト OFF。`NEXT_PUBLIC_PERF_LOG_ENABLED=1` のときのみ計測・出力する。
//   - PII / 機密の生値は絶対にログ出力しない。
//     出さない: email / userId / lineUserId / token / cookie / 本文 / credential
//     出す:    phase 名 / durationMs / route / count (= 件数等の数値のみ)
//   - browser console.log に出す (= ブラウザ DevTools で確認 / Vercel logs には乗らない)
//
// 用途:
//   - client 側で route 遷移 / API fetch waterfall の duration を観測する
//   - 例) page mount から主要コンテンツ表示までの体感速度を分解
//
// 既存の server-side `lib/perf.ts` と format を揃える (= `[perf:client] phase=...`)。

export const PERF_LOG_ENABLED_CLIENT = (() => {
  if (typeof process === "undefined") return false;
  const v = process.env.NEXT_PUBLIC_PERF_LOG_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true";
})();

// perf:diag: モジュール load 時に flag 値を 1 回 console に出力する。
// 目的: NEXT_PUBLIC_PERF_LOG_ENABLED が build に反映されているかをブラウザ DevTools
//       で確認するため (= 出ない場合は build cache 等で env が古い可能性)。
// PII / token / 本文は出さない (= boolean のみ)。
// 計測完了後はこの diag を削除する想定 (= 一時)。
if (typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.info(`[perf:client:diag] PERF_LOG_ENABLED_CLIENT=${PERF_LOG_ENABLED_CLIENT}`);
}

/**
 * Browser console に phase / durationMs を出す (= ON 時のみ)。
 * OFF 時は overhead 0 (= performance.now も呼ばない)。
 *
 * @example
 * const t0 = clientPerfStart();
 * await fetch(...);
 * clientPerfEnd("page:/messages:fetch", t0, { count: messages.length });
 */
export function clientPerfStart(): number {
  return PERF_LOG_ENABLED_CLIENT ? performance.now() : 0;
}

export function clientPerfEnd(
  phase: string,
  start: number,
  extras?: Record<string, string | number>,
): void {
  if (!PERF_LOG_ENABLED_CLIENT) return;
  const durationMs = Math.round(performance.now() - start);
  const extraStr = extras
    ? " " + Object.entries(extras).map(([k, v]) => `${k}=${v}`).join(" ")
    : "";
  // eslint-disable-next-line no-console
  console.log(`[perf:client] phase=${phase} durationMs=${durationMs}${extraStr}`);
}

/**
 * fn の実行時間を測る wrapper。
 *
 * @example
 * const data = await withClientTiming("page:/messages:list", () => messageApi.list(...));
 */
export async function withClientTiming<T>(phase: string, fn: () => Promise<T>): Promise<T> {
  if (!PERF_LOG_ENABLED_CLIENT) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const durationMs = Math.round(performance.now() - start);
    // eslint-disable-next-line no-console
    console.log(`[perf:client] phase=${phase} durationMs=${durationMs}`);
  }
}
