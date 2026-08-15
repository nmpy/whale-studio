// src/lib/broadcast/audience.ts
//
// 配信メッセージ（Broadcast）の宛先解決。**配信専用**の read-only リゾルバ。
//
// 位置づけ:
//   既存「応答メッセージ」の Runtime / webhook / reply 経路とは完全に独立している。
//   ここは既存テーブルを **読むだけ** で、UserProgress / Segment / UserTracking を
//   一切書き換えない。既存 Audience 画面 / Segment 画面の仕様も変更しない。
//
// なぜ UserProgress + UserTracking なのか:
//   Whale Studio には「OA の友だち台帳」テーブルが存在しない（follow webhook は
//   トラッキング帰属のみでレコードを作らない）。OA 単位で LINE ユーザー ID を
//   安全に引ける情報源は次の 2 つだけ:
//     - user_progress … 作品ごと。Work.oaId 経由で OA に絞れる
//     - user_trackings … @@unique(oaId, lineUserId)。トラッキング経由の友だち追加
//   よって配信対象は「Whale Studio が把握しているユーザー」であり、
//   **その OA の全友だちではない**。UI 側でもその旨を明示すること。

import { prisma } from "@/lib/prisma";

/** 配信対象の指定方法。 */
export type BroadcastTarget =
  | { type: "all" }
  /** 既存 Segment を使う。Segment の filterType は work スコープで評価されるため workId が要る。 */
  | { type: "segment"; segmentId: string; workId: string };

export interface ResolvedAudience {
  /** 重複除去・除外適用済みの宛先。順序は安定（昇順）。 */
  lineUserIds: string[];
  count: number;
}

/** LINE の userId は "U" + 32 桁の hex。テスト用の任意 ID や preview ID を弾く。 */
const LINE_USER_ID_RE = /^U[0-9a-f]{32}$/i;

/** 実際に LINE へ push できる宛先だけを残す。 */
export function isSendableLineUserId(v: unknown): v is string {
  return typeof v === "string" && LINE_USER_ID_RE.test(v);
}

/**
 * OA に属する Work の id 一覧。
 * ここを経由することで、他 OA の UserProgress を絶対に拾わない（OA isolation）。
 */
async function workIdsOfOa(oaId: string): Promise<string[]> {
  const works = await prisma.work.findMany({ where: { oaId }, select: { id: true } });
  return works.map((w) => w.id);
}

/** OA 単位の除外リスト（運営メンバー等）。analytics_excluded_users を流用する（read-only）。 */
async function excludedLineUserIdsOfOa(oaId: string): Promise<Set<string>> {
  const rows = await prisma.analyticsExcludedUser.findMany({
    where: { oaId },
    select: { lineUserId: true },
  });
  return new Set(rows.map((r) => r.lineUserId));
}

/**
 * 「全体」= その OA で Whale Studio が把握している配信可能ユーザー。
 *
 *   (OA 配下 Work の UserProgress) ∪ (UserTracking)
 *     − isPreview=true（管理者・テスターの疑似プレイ）
 *     − LINE userId 形式でないもの（テスト用の任意 ID）
 *     − analytics_excluded_users
 */
async function resolveAll(oaId: string): Promise<string[]> {
  const workIds = await workIdsOfOa(oaId);

  const [progress, trackings, excluded] = await Promise.all([
    workIds.length === 0
      ? Promise.resolve([] as { lineUserId: string }[])
      : prisma.userProgress.findMany({
          where: { workId: { in: workIds }, isPreview: false },
          select: { lineUserId: true },
          distinct: ["lineUserId"],
        }),
    prisma.userTracking.findMany({ where: { oaId }, select: { lineUserId: true } }),
    excludedLineUserIdsOfOa(oaId),
  ]);

  const set = new Set<string>();
  for (const r of [...progress, ...trackings]) {
    if (!isSendableLineUserId(r.lineUserId)) continue; // null / 空 / テスト ID を除外
    if (excluded.has(r.lineUserId)) continue;
    set.add(r.lineUserId); // Set が dedupe を保証する
  }
  return [...set].sort();
}

/**
 * Segment 指定。既存 Segment の filterType 判定ロジックと同じ意味論で評価する
 * （既存 /api/analytics/segments と同じ条件式。あちらは統計、こちらは宛先解決で用途が別なので
 *   共有せず、条件だけを揃えて配信側に閉じる）。
 *
 * Segment / Work が対象 OA のものでなければ空を返す（OA isolation）。
 */
async function resolveSegment(oaId: string, segmentId: string, workId: string): Promise<string[]> {
  const [segment, work] = await Promise.all([
    prisma.segment.findUnique({ where: { id: segmentId }, select: { id: true, oaId: true, filterType: true, phaseId: true } }),
    prisma.work.findUnique({ where: { id: workId }, select: { id: true, oaId: true } }),
  ]);
  // 他 OA の Segment / Work を指定されても絶対に解決しない
  if (!segment || segment.oaId !== oaId) return [];
  if (!work || work.oaId !== oaId) return [];

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const where: Record<string, unknown> = { workId, isPreview: false };
  if (segment.filterType === "friend_7d") {
    where.createdAt = { gte: sevenDaysAgo };
  } else if (segment.filterType === "inactive_7d") {
    where.reachedEnding = false;
    where.lastInteractedAt = { lt: sevenDaysAgo };
  } else if (segment.filterType === "phase") {
    // phaseId 未設定の phase セグメントは対象なしとする（全員送信に化けさせない）
    if (!segment.phaseId) return [];
    where.currentPhaseId = segment.phaseId;
  }

  const [progress, excluded] = await Promise.all([
    prisma.userProgress.findMany({ where, select: { lineUserId: true }, distinct: ["lineUserId"] }),
    excludedLineUserIdsOfOa(oaId),
  ]);

  const set = new Set<string>();
  for (const p of progress) {
    if (!isSendableLineUserId(p.lineUserId)) continue;
    if (excluded.has(p.lineUserId)) continue;
    set.add(p.lineUserId);
  }
  return [...set].sort();
}

/**
 * 配信対象を解決する。**必ずサーバー側でのみ呼ぶこと。**
 * クライアントから宛先配列を受け取ってそのまま送る経路は作らない。
 */
export async function resolveBroadcastAudience(
  oaId: string,
  target: BroadcastTarget,
): Promise<ResolvedAudience> {
  const lineUserIds =
    target.type === "all"
      ? await resolveAll(oaId)
      : await resolveSegment(oaId, target.segmentId, target.workId);

  return { lineUserIds, count: lineUserIds.length };
}

/** 対象人数だけ欲しいとき（STEP 2 の「配信予定人数」表示用）。 */
export async function countBroadcastAudience(oaId: string, target: BroadcastTarget): Promise<number> {
  const { count } = await resolveBroadcastAudience(oaId, target);
  return count;
}
