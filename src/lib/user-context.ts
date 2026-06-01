// src/lib/user-context.ts
//
// 認証済みリクエスト内で「現在のユーザー ID」を AsyncLocalStorage で伝搬するための薄い helper。
//
// 用途:
//   withAuth / withRole がハンドラ呼び出し時に runWithCurrentUserId(user.id, fn) で
//   ラップすると、下位レイヤ (plan-guard, RBAC など) は引数なしで getCurrentUserId() で
//   現在のリクエストのユーザー ID を取得できる。
//
// 設計:
//   - 既存の `src/lib/perf.ts` の `runWithRequestId` と同じパターン (= node:async_hooks)
//   - Edge / browser には AsyncLocalStorage が無いため Node ランタイム専用
//   - context 外で呼ぶと undefined を返す (= 既存挙動を壊さない、明示的に渡された userId が
//     優先される設計)

import { AsyncLocalStorage } from "node:async_hooks";

const userIdStore = new AsyncLocalStorage<string>();

/**
 * 現在のリクエストの userId を AsyncLocalStorage に束ねて fn を実行する。
 * withAuth ハンドラの呼び出しをこれでラップする想定。
 */
export function runWithCurrentUserId<T>(userId: string, fn: () => T): T {
  return userIdStore.run(userId, fn);
}

/**
 * AsyncLocalStorage から現在のリクエストの userId を取得する。
 * context 外で呼ばれた場合 (= バックグラウンドタスク / 起動時 init 等) は undefined。
 */
export function getCurrentUserId(): string | undefined {
  return userIdStore.getStore();
}
