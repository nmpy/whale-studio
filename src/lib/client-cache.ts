// src/lib/client-cache.ts
//
// 管理画面のクライアント側 hook が共有する、最小の module-scope TTL キャッシュ。
//
// 目的:
//   useWorkspaceRole (= /members/me) と useWorkLimit (= /plan-info) は AppHeader /
//   page / AccessPreviewBar から同一 OA に対して重複呼び出しされ、かつ画面遷移のたびに
//   再 fetch されていた。短 TTL の stale-while-revalidate キャッシュを共有することで:
//     - 同一 OA の role / plan を遷移をまたいで即時描画 (= warm 体感の改善)
//     - 取得済みなら loading フラッシュを出さない
//   ただし常に裏で revalidate するため、role / plan の変更は次サイクルで反映される
//   (= 認可は server が毎回判定するため UI 表示のみの cache)。
//
// 安全性:
//   - auth 変化 (login/logout/switch) で clearAllTtlCaches() を呼び全 cache を一掃する
//     (= 別ユーザーの role/plan を引きずらない)。AppHeader の onAuthStateChange から呼ぶ。
//   - 純関数的に now を注入でき、単体テスト可能。

type Entry<T> = { data: T; ts: number };

export interface TtlCache<T> {
  /** TTL 内なら data、超過/未登録なら null。 */
  get(key: string, now?: number): T | null;
  set(key: string, data: T, now?: number): void;
  clear(): void;
}

// 生成した全 cache を auth 変化時に一括 clear するためのレジストリ。
const registry: Array<{ clear: () => void }> = [];

/** TTL(ms) を持つ module-scope cache を生成する。生成時にレジストリへ自動登録。 */
export function createTtlCache<T>(ttlMs: number): TtlCache<T> {
  const store = new Map<string, Entry<T>>();
  const cache: TtlCache<T> = {
    get(key, now = Date.now()) {
      const e = store.get(key);
      if (!e) return null;
      if (now - e.ts > ttlMs) {
        store.delete(key);
        return null;
      }
      return e.data;
    },
    set(key, data, now = Date.now()) {
      store.set(key, { data, ts: now });
    },
    clear() {
      store.clear();
    },
  };
  registry.push(cache);
  return cache;
}

/** 認証状態の変化時に、全 TTL cache を一掃する（別ユーザーの role/plan を引きずらない）。 */
export function clearAllTtlCaches(): void {
  for (const c of registry) c.clear();
}
