// src/lib/admin-bootstrap-cache.ts
//
// メッセージ一覧 Bootstrap レスポンスのクライアント側キャッシュ（module-scope Map）。
//
// 目的:
//   - 一度開いた OA/work を再訪したとき、前回取得済みデータを即時表示する
//     （「真っ白な待ち時間」をなくす）。
//   - fresh（= 直近）なら network を張らず即表示、stale なら即表示しつつ裏で再取得。
//
// 方針:
//   - SWR / React Query は未導入のプロジェクトなので、既存の module-scope Map dedup
//     （useWorkspaceRole の inflight パターン）に倣った最小実装。
//   - 純関数として now を注入可能にし、単体テストできるようにする。
//   - メッセージ編集 / 削除 / 並び替え後は invalidate して次回再取得させる（stale 防止）。

import type { MessagesBootstrapData } from "@/lib/api-client";

/** これより新しい cache は「fresh」= 再 fetch せず即表示してよい。 */
export const BOOTSTRAP_FRESH_MS = 30_000; // 30s
/** これを超えた cache は即時表示にも使わない（古すぎるので破棄して fetch）。 */
export const BOOTSTRAP_MAX_AGE_MS = 5 * 60_000; // 5min

type Entry = { data: MessagesBootstrapData; ts: number };

const store = new Map<string, Entry>();

function keyOf(oaId: string, workId: string): string {
  return `${oaId}:${workId}`;
}

export type BootstrapCacheHit = {
  data:    MessagesBootstrapData;
  /** fresh（再 fetch 不要で即表示してよい）か。false の場合は表示しつつ裏で revalidate する。 */
  isFresh: boolean;
};

/**
 * cache から Bootstrap を取得する。
 * - MAX_AGE を超えた entry は破棄して null を返す（= 必ず fetch）。
 * - 生きていれば data + isFresh を返す。
 */
export function getCachedBootstrap(
  oaId: string,
  workId: string,
  now: number = Date.now(),
): BootstrapCacheHit | null {
  const entry = store.get(keyOf(oaId, workId));
  if (!entry) return null;
  const age = now - entry.ts;
  if (age > BOOTSTRAP_MAX_AGE_MS) {
    store.delete(keyOf(oaId, workId));
    return null;
  }
  return { data: entry.data, isFresh: age <= BOOTSTRAP_FRESH_MS };
}

/** Bootstrap を cache に保存する（取得成功時に呼ぶ）。 */
export function setCachedBootstrap(
  oaId: string,
  workId: string,
  data: MessagesBootstrapData,
  now: number = Date.now(),
): void {
  store.set(keyOf(oaId, workId), { data, ts: now });
}

/**
 * 指定 work の cache を無効化する（メッセージの作成/更新/削除/並び替え後に呼ぶ）。
 * 次回 mount 時に必ず最新を再取得させ、stale 表示を防ぐ。
 */
export function invalidateBootstrap(oaId: string, workId: string): void {
  store.delete(keyOf(oaId, workId));
}

/** テスト用: 全 cache をクリアする。 */
export function _clearBootstrapCacheForTest(): void {
  store.clear();
}
