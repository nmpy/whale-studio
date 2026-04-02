// src/lib/cache.ts
// シンプルなインメモリ TTL キャッシュ（Next.js サーバーサイド・サーバーレス向け）
//
// ▸ Map ベースの軽量実装。永続化は行わない。
// ▸ 同一インスタンス（ウォームコンテナ）内の短時間の連続アクセスを高速化するのが目的。
// ▸ Vercel / serverless 環境では「コールドスタート後の最初のリクエストは常に miss」になるが
//   2 回目以降のアクセスはキャッシュ hit になる。

// ── 型 ──────────────────────────────────────────────────────

type CacheEntry<T> = {
  value:     T;
  expiresAt: number;  // Date.now() + TTL ms
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store = new Map<string, CacheEntry<any>>();

// ── TTL 定数（ms）───────────────────────────────────────────

export const TTL = {
  /** OA（channel_secret / channel_access_token 含む）: 5 分 */
  OA:          5 * 60 * 1000,
  /** アクティブ Work（publish_status: active）: 2 分 */
  WORK:        2 * 60 * 1000,
  /** Phase 全データ（messages + transitions）: 1 分 */
  PHASE:       1 * 60 * 1000,
  /** グローバルコマンド一覧: 2 分 */
  GLOBAL_CMD:  2 * 60 * 1000,
  /** Start Phase レコード: 2 分 */
  START_PHASE: 2 * 60 * 1000,
  /** 作品共通キーワードメッセージ（phaseId = null）: 2 分 */
  GLOBAL_KW:   2 * 60 * 1000,
} as const;

// ── 基本操作 ─────────────────────────────────────────────────

/**
 * キャッシュから値を取得する。
 * 期限切れ、または存在しない場合は `null` を返す。
 */
export function getCache<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * キャッシュに値を設定する。
 * @param ttlMs  有効期間 (ms)。TTL 定数を推奨。
 */
export function setCache<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * 指定キーのキャッシュを削除する（invalidate）。
 * 存在しない場合は何もしない。
 */
export function deleteCache(key: string): void {
  store.delete(key);
}

/**
 * 指定プレフィックスで始まるキャッシュエントリを全て削除する。
 * 例: `deleteCacheByPrefix("phase:full:")` で全フェーズキャッシュを一括消去。
 */
export function deleteCacheByPrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/**
 * 期限切れのエントリを削除する（GC 相当）。
 * 必要に応じて定期呼び出し可能だが、getCache でも期限切れ時に自動削除される。
 */
export function clearExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) store.delete(key);
  }
}

/** 現在のキャッシュエントリ数を返す（デバッグ・監視用）。 */
export function cacheSize(): number {
  return store.size;
}

// ── キャッシュキー定数（webhook / API ルートで共有）──────────

export const CACHE_KEY = {
  oa:         (lineOaId:  string) => `oa:${lineOaId}`,
  oaReverse:  (oaId:      string) => `oa:id-to-line:${oaId}`,
  work:       (oaId:      string) => `work:active:${oaId}`,
  phase:      (phaseId:   string) => `phase:full:${phaseId}`,
  globalCmd:  (oaId:      string) => `globalcmd:${oaId}`,
  startPhase: (workId:    string) => `startphase:${workId}`,
  globalKw:   (workId:    string) => `work:global-kw:${workId}`,
} as const;

// ── 抽象インターフェース（Upstash Redis 等へ切り替え可能）────

/**
 * キャッシュバックエンドの非同期インターフェース。
 * MemoryCache（デフォルト）と UpstashCache を同一 API で切り替えられる。
 *
 * Redis に移行する場合:
 *   1. `npm install @upstash/redis`
 *   2. UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN を環境変数に設定
 *   3. `src/lib/cache-upstash.ts` を参照し、`activeCache` を差し替える（1 行変更）
 */
export interface ICache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
}

/** 既存の Map ベース同期関数をラップした ICache 実装（デフォルト） */
export class MemoryCache implements ICache {
  async get<T>(key: string): Promise<T | null>                        { return getCache<T>(key);          }
  async set<T>(key: string, value: T, ttlMs: number): Promise<void>   { setCache(key, value, ttlMs);      }
  async delete(key: string): Promise<void>                             { deleteCache(key);                  }
  async deleteByPrefix(prefix: string): Promise<void>                  { deleteCacheByPrefix(prefix);       }
}

/**
 * アクティブなキャッシュインスタンス（デフォルト: MemoryCache）。
 *
 * Upstash Redis に切り替えるには、以下のように 2 行を変更する:
 *   import { UpstashCache } from "@/lib/cache-upstash";
 *   export const activeCache: ICache = new UpstashCache(
 *     process.env.UPSTASH_REDIS_REST_URL!,
 *     process.env.UPSTASH_REDIS_REST_TOKEN!,
 *   );
 *
 * 注意: API ルートの `await activeCache.delete(key)` は Redis でも機能する。
 *       webhook 内の OA / Work の inline getCache/setCache は別途移行が必要（TODO）。
 */
export const activeCache: ICache = new MemoryCache();
