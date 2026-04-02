// src/lib/cache-upstash.ts
// Upstash Redis を使った ICache 実装。
//
// 利用手順:
//   1. `npm install @upstash/redis`
//   2. 環境変数を設定:
//        UPSTASH_REDIS_REST_URL=https://your-endpoint.upstash.io
//        UPSTASH_REDIS_REST_TOKEN=your-token
//   3. src/lib/cache.ts 末尾の `activeCache` を以下に差し替え（2 行変更）:
//        import { UpstashCache } from "@/lib/cache-upstash";
//        export const activeCache: ICache = new UpstashCache(
//          process.env.UPSTASH_REDIS_REST_URL!,
//          process.env.UPSTASH_REDIS_REST_TOKEN!,
//        );

import type { ICache } from "@/lib/cache";

// @upstash/redis は任意依存なので dynamic import で読み込む
// （インストール前でも他のコードが import できるよう型だけ参照）
type RedisClient = {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, opts?: { px?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  scan(cursor: number, opts?: { match?: string; count?: number }): Promise<[number, string[]]>;
};

export class UpstashCache implements ICache {
  private redis: RedisClient;

  constructor(url: string, token: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require("@upstash/redis") as { Redis: new (opts: { url: string; token: string }) => RedisClient };
    this.redis = new Redis({ url, token });
  }

  async get<T>(key: string): Promise<T | null> {
    return (await this.redis.get<T>(key)) ?? null;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await this.redis.set(key, value, { px: ttlMs });
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /**
   * 指定プレフィックスで始まるキーを SCAN で列挙して一括削除する。
   * Serverless 環境で KEYS コマンドを使わずに安全に削除できる。
   */
  async deleteByPrefix(prefix: string): Promise<void> {
    let cursor = 0;
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, {
        match: `${prefix}*`,
        count: 100,
      });
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== 0);
  }
}
