"use client";

// src/lib/perf-client.ts
//
// 管理画面のクライアント側 perf マーカー。
// 本番で「初期表示の何に何 ms かかったか」を Browser Console で観測するための軽量ログ。
//
// 方針 (= server 側 PERF_LOG_ENABLED と対):
//   - 既定 OFF。`NEXT_PUBLIC_PERF_LOG=1` のビルド時のみ出力する。
//   - OFF 時は関数が即 return し overhead を出さない。
//   - PII を出さない。oaId / workId は先頭 8 桁マスク (maskId) のみ許可。

/** ビルド時に注入される client 用 perf フラグ。OFF 時はログ抑止。 */
export const PERF_CLIENT_ON = process.env.NEXT_PUBLIC_PERF_LOG === "1";

/** UUID 等の識別子を先頭 8 桁にマスクする（PII / 全長露出を避ける）。 */
export function maskId(id: string | null | undefined): string {
  if (!id) return "";
  return `${id.slice(0, 8)}…`;
}

/**
 * 管理画面 perf マーカーを 1 行で出力する。
 * 例: logAdminPerf("/oas/[id]/works/[workId]/messages", { bootstrapFetch: 180, cache: "miss" })
 *   → [perf:client:admin] route=/oas/.../messages bootstrapFetch=180ms cache=miss
 */
export function logAdminPerf(route: string, fields: Record<string, string | number>): void {
  if (!PERF_CLIENT_ON) return;
  const parts = Object.entries(fields)
    .map(([k, v]) => (typeof v === "number" ? `${k}=${v}ms` : `${k}=${v}`))
    .join(" ");
  // eslint-disable-next-line no-console
  console.log(`[perf:client:admin] route=${route} ${parts}`);
}

/**
 * 現在までに読み込まれた resource の件数と転送量(KB)を返す。
 * 初期表示直後に呼んで「何本 / 何 KB 読み込んだか」を可視化する。
 * transferSize は cache hit 時 0 になり得る点に注意（おおよその指標）。
 */
export function resourceSummary(): { count: number; transferredKB: number } {
  try {
    const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const bytes = entries.reduce((sum, e) => sum + (e.transferSize || 0), 0);
    return { count: entries.length, transferredKB: Math.round(bytes / 1024) };
  } catch {
    return { count: 0, transferredKB: 0 };
  }
}
