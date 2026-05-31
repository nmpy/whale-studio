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
  /** start フェーズの kind="start" メッセージ群（startTrigger 演出）: 2 分 */
  START_MSGS:  2 * 60 * 1000,
  /**
   * userProgress（currentPhaseId / reachedEnding / flags）: 10 秒
   *
   * LINE は 1 ユーザーのメッセージを逐次配送するため、短 TTL + write-through で
   * 整合性を保ちつつ findUnique の DB ラウンドトリップを大幅削減できる。
   * upsert / update 直後は必ず setCachedProgress() で上書きすること。
   */
  PROGRESS:    10 * 1000,
  /**
   * Whale Studio Live の entitlement 有効フラグ: 60 秒
   *
   * 管理画面の複数ページ（/oas/[id] / settings / sidenav 等）で連続して
   * isLiveEnabled() を呼ぶため、短 TTL で DB ラウンドトリップを削減。
   * /api/admin/oa-entitlements PATCH 成功時に必ず invalidation すること。
   */
  LIVE_ENABLED: 60 * 1000,
  /**
   * OA を internal id で引いた結果（ownerKey 含む）: 60 秒
   *
   * `/api/messages` GET / POST と `/api/works` GET で requireRole の認可判定に必要な
   * ownerKey 取得用。warm 計測 (PR #159 後) で db:work 740ms / api/works:db:oa
   * ~700-890ms と判明したため、id → ownerKey 引きを cache 化する。
   *
   * 短 TTL (60s) で保守的に運用。ownerKey 変更 (ownership transfer) は稀だが、
   * /api/oas/[id] PATCH / DELETE / rich-menus/[id]/apply で write 後に必ず
   * invalidateOaCacheById() を呼ぶこと。
   */
  OA_BY_ID:    60 * 1000,
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
//
// キャッシュ shape のバージョン管理:
//   message オブジェクトに新フィールド (free_input_enabled / next_message_id 等) を
//   追加した際、過去 deploy 時点で書き込まれた cache entry には新フィールドが
//   含まれない (= 古い shape のままで残る)。次回 read で undefined となり、
//   runtime の判定 (`m.free_input_enabled === true` 等) が常に false で素通りする。
//
//   shape 変更時は cache key suffix (:v2 / :v3) を bump して、過去 entry を
//   読み出し対象から外す。古い entry は TTL で自然消滅する。

/**
 * Message shape version. RuntimePhaseMessage / KeywordMessageRecord に
 * free_input_enabled / freeInputEnabled が含まれるよう PR #147 (2026-05-31) で v2 に bump。
 */
const MESSAGE_SHAPE_VERSION = "v2";

export const CACHE_KEY = {
  oa:         (lineOaId:  string) => `oa:${lineOaId}`,
  oaReverse:  (oaId:      string) => `oa:id-to-line:${oaId}`,
  work:       (oaId:      string) => `work:active:${oaId}`,
  phase:      (phaseId:   string) => `phase:full:${MESSAGE_SHAPE_VERSION}:${phaseId}`,
  globalCmd:  (oaId:      string) => `globalcmd:${oaId}`,
  startPhase: (workId:    string) => `startphase:${workId}`,
  globalKw:   (workId:    string) => `work:global-kw:${MESSAGE_SHAPE_VERSION}:${workId}`,
  startMsgs:  (phaseId:   string) => `startmsgs:${MESSAGE_SHAPE_VERSION}:${phaseId}`,
  progress:   (userId:    string, workId: string) => `progress:${userId}:${workId}`,
  liveEnabled:(oaId:      string) => `live:enabled:${oaId}`,
  /**
   * OA を internal id で引いた結果のキャッシュキー。
   * value shape: `{ id, ownerKey }` (OaByIdCached, src/lib/oa-cache.ts)
   * shape 変更時は :v1 → :v2 に bump して過去 entry を破棄する。
   */
  oaById:     (id:        string) => `oa:by-id:v1:${id}`,
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
 * アクティブなキャッシュインスタンス。環境変数で自動選択:
 *
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN 設定済み
 *     → UpstashCache（Upstash Redis REST API）
 *   未設定
 *     → MemoryCache（インメモリ Map、同一コンテナ内のみ有効）
 *
 * Upstash Redis への切り替え手順（コード変更不要）:
 *   1. https://console.upstash.com で Redis DB を作成
 *   2. Vercel プロジェクトの Environment Variables に以下を追加:
 *        UPSTASH_REDIS_REST_URL   = https://xxx.upstash.io
 *        UPSTASH_REDIS_REST_TOKEN = AXxx...
 *   3. Vercel に再デプロイ → ログで [cache] provider=UpstashCache を確認
 */
export const activeCache: ICache = (() => {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    // serverExternalPackages により webpack バンドル対象外（runtime require）
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("./cache-upstash") as { UpstashCache: new (u: string, t: string) => ICache };
    return new mod.UpstashCache(url, token);
  }
  return new MemoryCache();
})();
