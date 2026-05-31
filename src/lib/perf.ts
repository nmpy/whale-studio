// src/lib/perf.ts
// パフォーマンス計測ログのヘルパー。
//
// 方針（厳守）:
//   - デフォルト OFF。`PERF_LOG_ENABLED=1` または `=true` のときのみ計測・出力する。
//   - OFF のとき、`performance.now()` 等のコストも発生させず fn を直接実行する（hot path 配慮）。
//   - PII / 機密の生値は絶対にログ出力しない。
//     出さない: authorization / cookie / channel_access_token / channel_secret /
//               webhook secret / lineUserId / email / Stripe key / Supabase key 等。
//     出す:    phase 名 / durationMs / Prisma の model+action / 短い requestId（紐づき無し）。
//
// 設計:
//   - `withTiming(phase, fn)`: 同期/非同期どちらでも fn を実行し、ON なら durationMs をログ。
//   - `runWithRequestId(id, fn)`: AsyncLocalStorage で request 単位 ID を伝播。
//   - `genRequestId()`: 短い UUID（先頭 8 文字）。ユーザーには紐づかない。
//   - `logSlow(...)`: 200ms 超の Prisma クエリなどの slow log。

import { AsyncLocalStorage } from "node:async_hooks";

/** 計測 ON/OFF を 1 箇所で判定。env を都度文字列比較するコストを避けるため、モジュールロード時に確定。 */
export const PERF_LOG_ENABLED = (() => {
  const v = process.env.PERF_LOG_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true";
})();

/** slow log の閾値（ms）。Prisma クエリなど。 */
export const PERF_SLOW_MS = 200;

// ── requestId の伝播 ─────────────────────────────────────────────
// Edge runtime / browser には AsyncLocalStorage が無いため、Node のみで動作。
// 値が無いときは "-" を返す（ログ上は requestId 欠落が分かる）。
const requestIdStore = new AsyncLocalStorage<string>();

export function genRequestId(): string {
  // crypto.randomUUID は Node 19+ / Edge / Web で利用可能。fallback は不要。
  return crypto.randomUUID().slice(0, 8);
}

export function getRequestId(): string {
  return requestIdStore.getStore() ?? "-";
}

/**
 * requestId を AsyncLocalStorage で fn 実行中だけ束ねる。
 * OFF 時はそのまま fn を呼んで overhead を出さない。
 */
export function runWithRequestId<T>(id: string, fn: () => Promise<T>): Promise<T> {
  if (!PERF_LOG_ENABLED) return fn();
  return requestIdStore.run(id, fn);
}

// ── 計測 helper ──────────────────────────────────────────────────

/**
 * `phase` を計測ログとして出力する（ON 時のみ）。OFF 時は単に fn を await する。
 * `phase` には英数字とハイフンのみを推奨（ログを構造化しやすくするため）。
 * fn 内で例外が出た場合も `[perf]` を出してから例外を再 throw する（catch しない）。
 */
export async function withTiming<T>(phase: string, fn: () => Promise<T>): Promise<T> {
  if (!PERF_LOG_ENABLED) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const durationMs = Math.round(performance.now() - start);
    // 出力するのは phase / durationMs / requestId のみ。引数や body には触れない。
    // eslint-disable-next-line no-console
    console.log(`[perf] requestId=${getRequestId()} phase=${phase} durationMs=${durationMs}`);
  }
}

/**
 * 同期関数版。Prisma の query hook など、awaited operation の duration を直接渡したいとき用。
 * fn 自体は呼ばない。値だけ受け取って出力する。
 */
export function logPhase(phase: string, durationMs: number, extras?: Record<string, string | number>): void {
  if (!PERF_LOG_ENABLED) return;
  const extraStr = extras
    ? " " + Object.entries(extras).map(([k, v]) => `${k}=${v}`).join(" ")
    : "";
  // eslint-disable-next-line no-console
  console.log(`[perf] requestId=${getRequestId()} phase=${phase} durationMs=${durationMs}${extraStr}`);
}

/**
 * slow log（既定で 200ms 超）。kind は `db:slow` `line:slow` 等のタグ。
 * PII を含まないことを呼び出し側で保証すること（model / action / durationMs のみ推奨）。
 */
export function logSlow(kind: string, fields: Record<string, string | number>): void {
  if (!PERF_LOG_ENABLED) return;
  const fieldStr = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(" ");
  // eslint-disable-next-line no-console
  console.log(`[perf:${kind}] requestId=${getRequestId()} ${fieldStr}`);
}

/**
 * fire-and-forget 用の duration 計測。
 *
 * 用途: `withAuth` の fire-and-forget hook (recordUserActivity / ensureProfile /
 * checkMembershipIntegrity 等) のように、caller が await せず Promise を放置する
 * 経路で duration を log したいとき。
 *
 * 動作:
 *   - **同期的に void を返す** (= caller は await しない / できない)
 *   - 内部で fn() を起動し、完了/失敗時に `[perf][<kind>] name=<name> durationMs=N` を log
 *   - error は silent catch (= 既存 fire-and-forget の挙動と整合)
 *   - PERF_LOG_ENABLED OFF 時は fn() を起動するだけで計測しない (overhead 最小)
 *
 * extras はログ末尾に追加情報 (key=value 形式)。userId は事前に mask して渡すこと。
 */
export function withTimingFnf(
  kind: string,
  name: string,
  fn: () => Promise<unknown>,
  extras?: Record<string, string | number>,
): void {
  if (!PERF_LOG_ENABLED) {
    // overhead 最小: 計測なしで fn を起動して silent catch のみ
    fn().catch(() => { /* silent */ });
    return;
  }
  const start = performance.now();
  const requestId = getRequestId();
  fn()
    .catch(() => { /* silent — caller と同じ挙動 */ })
    .finally(() => {
      const durationMs = Math.round(performance.now() - start);
      const extraStr = extras
        ? " " + Object.entries(extras).map(([k, v]) => `${k}=${v}`).join(" ")
        : "";
      // eslint-disable-next-line no-console
      console.log(`[perf][${kind}] requestId=${requestId} name=${name} durationMs=${durationMs}${extraStr}`);
    });
}

/**
 * fire-and-forget hook が skip されたことを log する (PERF_LOG_ENABLED ON 時のみ)。
 *
 * skip reason は `throttled` / `alreadyChecked` / `dev-stub` 等。
 * userId 等の PII は事前に mask して渡すこと。
 */
export function logFnfSkip(
  kind: string,
  name: string,
  reason: string,
  extras?: Record<string, string | number>,
): void {
  if (!PERF_LOG_ENABLED) return;
  const extraStr = extras
    ? " " + Object.entries(extras).map(([k, v]) => `${k}=${v}`).join(" ")
    : "";
  // eslint-disable-next-line no-console
  console.log(`[perf][${kind}] requestId=${getRequestId()} name=${name} skipped reason=${reason}${extraStr}`);
}
