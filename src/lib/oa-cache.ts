// src/lib/oa-cache.ts
// OA を internal id で引いた結果 ({ id, ownerKey }) のキャッシュヘルパー。
//
// 動機 (PR #160 / 2026-06-01):
//   warm 計測で /api/messages GET の db:work が 740ms、/api/works の db:oa が
//   ~700-890ms と判明。`requireRole` 内部の `Oa.findUnique({select:{ownerKey}})` が
//   主な遅延源だった。ownerKey は ownership transfer の稀な write でしか変わらないため、
//   短 TTL (60s) で安全に cache 化する。
//
// 適用箇所:
//   - /api/messages GET / POST
//   - /api/works GET
//
// 取得値は requireRole の `preloadedOa` 経由で渡され、内部 Oa.findUnique をスキップする。
//
// invalidation:
//   - /api/oas/[id] PATCH / DELETE
//   - /api/rich-menus/[id]/apply
//   write 後に必ず invalidateOaCacheById(id) を呼ぶこと。
//
// PII / token / secret は出さない。MISS ログのみ oaId を 8 文字 mask して出す
// (= 既存 [cache] xxx MISS パターン踏襲)。

import { prisma } from "@/lib/prisma";
import { activeCache, CACHE_KEY, TTL } from "@/lib/cache";

/** OA cache の保存値。requireRole の preloadedOa 互換 ({ ownerKey }) を満たすこと。 */
export type OaByIdCached = {
  id:       string;
  ownerKey: string | null;
};

/**
 * OA を internal id で引いてキャッシュ越しに返す。
 *
 * - cache hit:  そのまま返す (DB ラウンドトリップなし、~5ms 想定)
 * - cache miss: prisma.oa.findUnique → cache.set → 返す (~200-500ms)
 * - OA 不在 (null): cache せず null を返す (= notFound 検出の遅延を最小化)
 */
export async function getCachedOaById(id: string): Promise<OaByIdCached | null> {
  const key = CACHE_KEY.oaById(id);
  const hit = await activeCache.get<OaByIdCached>(key);
  if (hit) return hit;

  // miss ログ (既存 webhook の [cache] xxx MISS と同パターン。常時出すが PII は出さない)
  // eslint-disable-next-line no-console
  console.log(`[cache] oa-by-id MISS id=${id.slice(0, 8)}…`);

  const oa = await prisma.oa.findUnique({
    where:  { id },
    select: { id: true, ownerKey: true },
  });
  if (!oa) return null;

  await activeCache.set(key, oa, TTL.OA_BY_ID);
  return oa;
}

/**
 * OA cache を invalidate する。OA write (PATCH / DELETE / ownership transfer 等) 後に呼ぶ。
 *
 * 失敗しても caller には伝播させない (= UX 上のエラーにせず、TTL 経由で自然 expire させる)。
 */
export async function invalidateOaCacheById(id: string): Promise<void> {
  try {
    await activeCache.delete(CACHE_KEY.oaById(id));
  } catch {
    // best-effort; cache 削除失敗は TTL で自然回復する
  }
}
