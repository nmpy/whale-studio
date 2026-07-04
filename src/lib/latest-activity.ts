// src/lib/latest-activity.ts
//
// 「アカウント配下の最新活動日時（latestActivityAt）」をサーバ側で集計する。
//   - 表示（アカウント一覧の「更新日時」）とソート（最終更新が新しい順）を同じ値に揃えるための算出元。
//   - Oa.updatedAt だけでなく、配下の Work / Phase / Message / Character / LIFF / X投稿 / リッチメニュー
//     など「CMS で編集される子データ」の updatedAt の最大を含める。
//
// パフォーマンス方針（N+1 を作らない）:
//   - ページ分の OA ID / Work ID をまとめて `in` で渡し、モデル種別ごとに 1 本の
//     findMany / groupBy(_max) で取得する。OA 数が増えてもクエリ本数は一定。
//
// 削除操作について:
//   - 全 CMS 編集を記録する OperationLog は存在しない（AppActivityLog は per-user の lastSeen、
//     AdminAuditLog は platform 管理操作のみ）。子レコードの updatedAt を集計する方式のため、
//     「削除」は削除された行の updatedAt が残らず latestActivityAt に反映されない場合がある。
//     広範な更新 API に touch の副作用を入れない方針（表示/ソートの算出元変更に限定）。

import { prisma } from "@/lib/prisma";

/** 渡された日時（Date / ISO文字列 / null / 不正値）のうち、有効な最大日時を返す。無ければ null。 */
export function latestOf(...values: Array<Date | string | null | undefined>): Date | null {
  let best: number | null = null;
  for (const v of values) {
    if (v == null) continue;
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
    if (Number.isNaN(t)) continue;
    if (best === null || t > best) best = t;
  }
  return best === null ? null : new Date(best);
}

const MAX_UPDATED = { updatedAt: true } as const;

/**
 * 作品ごとの最新活動日時 Map<workId, Date>。
 * work.updatedAt と、配下 Phase / Message / Character / LiffPageConfig の max(updatedAt) の最大。
 * （bounded: 5 クエリ。workIds が空なら即 return）
 */
export async function fetchWorkLatestActivityMap(workIds: string[]): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (workIds.length === 0) return map;

  const [works, phases, messages, characters, liff] = await Promise.all([
    prisma.work.findMany({ where: { id: { in: workIds } }, select: { id: true, updatedAt: true, createdAt: true } }),
    prisma.phase.groupBy({ by: ["workId"], where: { workId: { in: workIds } }, _max: MAX_UPDATED }),
    prisma.message.groupBy({ by: ["workId"], where: { workId: { in: workIds } }, _max: MAX_UPDATED }),
    prisma.character.groupBy({ by: ["workId"], where: { workId: { in: workIds } }, _max: MAX_UPDATED }),
    prisma.liffPageConfig.groupBy({ by: ["workId"], where: { workId: { in: workIds } }, _max: MAX_UPDATED }),
  ]);

  const acc = new Map<string, Array<Date | null>>();
  const add = (workId: string, d: Date | null | undefined) => {
    const arr = acc.get(workId) ?? [];
    arr.push(d ?? null);
    acc.set(workId, arr);
  };
  for (const w of works) { add(w.id, w.updatedAt); add(w.id, w.createdAt); }
  for (const g of phases)     add(g.workId, g._max.updatedAt);
  for (const g of messages)   add(g.workId, g._max.updatedAt);
  for (const g of characters) add(g.workId, g._max.updatedAt);
  for (const g of liff)       add(g.workId, g._max.updatedAt);

  for (const [workId, dates] of acc) {
    const best = latestOf(...dates);
    if (best) map.set(workId, best);
  }
  return map;
}

/**
 * OA ごとの最新活動日時 Map<oaId, Date>。
 * 配下 Work 群の latestActivityAt（= work + phase/message/character/liff）と、
 * OA 直下の RichMenu / XPost の max(updatedAt) の最大。
 * ※ Oa 自身の updatedAt / createdAt は呼び出し側で latestOf に合成する（フォールバックの起点にするため）。
 * （bounded: works の findMany + fetchWorkLatestActivityMap(5) + oa 直下 2 = 定数本数）
 */
export async function fetchOaLatestActivityMap(oaIds: string[]): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (oaIds.length === 0) return map;

  const works = await prisma.work.findMany({ where: { oaId: { in: oaIds } }, select: { id: true, oaId: true } });
  const workIds = works.map((w) => w.id);
  const workToOa = new Map(works.map((w) => [w.id, w.oaId] as const));

  const [workLatest, richMenus, xposts] = await Promise.all([
    fetchWorkLatestActivityMap(workIds),
    prisma.richMenu.groupBy({ by: ["oaId"], where: { oaId: { in: oaIds } }, _max: MAX_UPDATED }),
    prisma.xPost.groupBy({ by: ["oaId"], where: { oaId: { in: oaIds } }, _max: MAX_UPDATED }),
  ]);

  const acc = new Map<string, Array<Date | null>>();
  const add = (oaId: string, d: Date | null | undefined) => {
    const arr = acc.get(oaId) ?? [];
    arr.push(d ?? null);
    acc.set(oaId, arr);
  };
  for (const [workId, d] of workLatest) {
    const oaId = workToOa.get(workId);
    if (oaId) add(oaId, d);
  }
  for (const g of richMenus) add(g.oaId, g._max.updatedAt);
  for (const g of xposts)    add(g.oaId, g._max.updatedAt);

  for (const [oaId, dates] of acc) {
    const best = latestOf(...dates);
    if (best) map.set(oaId, best);
  }
  return map;
}
