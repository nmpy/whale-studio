// src/lib/owner-dashboard/activity.ts
// スタジオ全体ダッシュボードの「全アカウント横断アクティビティ（直近8件）」の集約。
//   - 既存の構造化ログのみを使用（Vercel/生ログ・文字列検索に依存しない）。読み取り専用・DB変更なし。
//   - 各ソースを occurredAt 降順で少数だけ取得 → サーバーでマージ → 最新8件へ切り詰め（N+1 なし）。
//   - アカウント名・作品→OA の対応は Map で一括解決（イベント1件ごとの追加クエリはしない）。
//   - プレイヤーは匿名タグ（playerTag・OA salt）で表示。生 LINE userId / PII は出さない。
//   - サーバー専用（API ルートとして公開しない＝直接の未認可アクセス経路を作らない）。呼び出し側
//     （/admin/dashboard）が platform owner を厳格判定する。

import { prisma } from "@/lib/prisma";
import { type ActivityKind, playerTag, liffEventToActivity, beaconEventToActivity } from "@/lib/activity-feed";

export interface OwnerActivityItem {
  id: string;
  /** 発生時刻（ISO / UTC）。表示は JST。 */
  occurredAt: string;
  oaId: string;
  accountName: string;
  /** 匿名プレイヤータグ（生 userId 非露出）。匿名イベントは "プレイヤー"。 */
  player: string;
  type: ActivityKind;
  title: string;
  detail: string | null;
}

const PER_SOURCE = 12; // 各ソースの取得上限（bounded）
const LIMIT = 8;       // 最終表示件数

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

function clip(s: string, n = 60): string {
  const t = (s ?? "").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

/**
 * 全アカウント横断の最新アクティビティ（最大8件）。
 * ソースごとに take:12 で取得しマージ後に8件へ切り詰める（期間セレクトとは独立の「最新」）。
 */
export async function getOwnerActivity(): Promise<OwnerActivityItem[]> {
  // ── 対応表 + 除外ユーザー（運営/テスター）──
  const [oas, works, excluded] = await Promise.all([
    safe(prisma.oa.findMany({ select: { id: true, title: true } }), [] as { id: string; title: string }[]),
    safe(prisma.work.findMany({ select: { id: true, oaId: true } }), [] as { id: string; oaId: string }[]),
    safe(prisma.analyticsExcludedUser.findMany({ select: { oaId: true, lineUserId: true } }), [] as { oaId: string; lineUserId: string }[]),
  ]);
  const oaName = new Map(oas.map((o) => [o.id, o.title]));
  const workOa = new Map(works.map((w) => [w.id, w.oaId]));
  const excludedSet = new Set(excluded.map((e) => `${e.oaId}:${e.lineUserId}`));
  const workIds = works.map((w) => w.id);
  const hasWorks = workIds.length > 0;
  const nameOf = (oaId: string | undefined | null) => (oaId ? oaName.get(oaId) ?? "不明なアカウント" : "不明なアカウント");
  const isExcluded = (oaId: string | undefined | null, uid: string | null | undefined) => !!(oaId && uid && excludedSet.has(`${oaId}:${uid}`));

  // ── 各ソースを bounded に並列取得（表示に不要な payload/JSON は select しない）──
  const [liff, visits, hints, beacons, puzzles, submits, scheduled] = await Promise.all([
    hasWorks ? safe(prisma.liffEventLog.findMany({ where: { workId: { in: workIds } }, orderBy: { createdAt: "desc" }, take: PER_SOURCE, select: { id: true, createdAt: true, lineUserId: true, eventType: true, workId: true } }), []) : Promise.resolve([]),
    hasWorks ? safe(prisma.locationVisit.findMany({ where: { workId: { in: workIds } }, orderBy: { visitedAt: "desc" }, take: PER_SOURCE, select: { id: true, visitedAt: true, lineUserId: true, workId: true, location: { select: { name: true } } } }), []) : Promise.resolve([]),
    safe(prisma.hintLog.findMany({ orderBy: { createdAt: "desc" }, take: PER_SOURCE, select: { id: true, createdAt: true, lineUserId: true, oaId: true } }), []),
    safe(prisma.beaconEventLog.findMany({ orderBy: { createdAt: "desc" }, take: PER_SOURCE, select: { id: true, createdAt: true, lineUserId: true, oaId: true, isRedelivery: true, actionStatus: true } }), []),
    hasWorks ? safe(prisma.puzzleDelivery.findMany({ where: { workId: { in: workIds } }, orderBy: { deliveredAt: "desc" }, take: PER_SOURCE, select: { id: true, deliveredAt: true, lineUserId: true, workId: true } }), []) : Promise.resolve([]),
    safe(prisma.liffSubmission.findMany({ orderBy: { createdAt: "desc" }, take: PER_SOURCE, select: { id: true, createdAt: true, lineUserId: true, oaId: true } }), []),
    safe(prisma.scheduledLineMessage.findMany({ where: { status: { in: ["sent", "failed"] } }, orderBy: { updatedAt: "desc" }, take: PER_SOURCE, select: { id: true, updatedAt: true, sentAt: true, lineUserId: true, oaId: true, status: true } }), []),
  ]);

  const items: OwnerActivityItem[] = [];
  const push = (id: string, at: Date, oaId: string | undefined | null, uid: string | null | undefined, type: ActivityKind, title: string, detail: string | null = null) => {
    if (!oaId || isExcluded(oaId, uid)) return;
    items.push({ id, occurredAt: at.toISOString(), oaId, accountName: nameOf(oaId), player: playerTag(uid, oaId), type, title: clip(title), detail: detail ? clip(detail) : null });
  };

  for (const r of liff) {
    const m = liffEventToActivity(r.eventType);
    if (!m) continue;
    push(`liff:${r.id}`, r.createdAt, workOa.get(r.workId), r.lineUserId, m.kind, m.detail);
  }
  for (const r of visits) {
    push(`visit:${r.id}`, r.visitedAt, workOa.get(r.workId), r.lineUserId, "location", `ロケーション「${r.location?.name ?? "現地"}」にチェックインしました`);
  }
  for (const r of hints) {
    push(`hint:${r.id}`, r.createdAt, r.oaId, r.lineUserId, "hint", "ヒントを使用しました");
  }
  for (const r of beacons) {
    const m = beaconEventToActivity({ isRedelivery: r.isRedelivery, actionStatus: r.actionStatus });
    push(`beacon:${r.id}`, r.createdAt, r.oaId, r.lineUserId, m.kind, m.detail);
  }
  for (const r of puzzles) {
    push(`puzzle:${r.id}`, r.deliveredAt, workOa.get(r.workId), r.lineUserId, "receive", "問題メッセージを配信しました");
  }
  for (const r of submits) {
    push(`submit:${r.id}`, r.createdAt, r.oaId, r.lineUserId, "answer", "フォームを送信しました");
  }
  for (const r of scheduled) {
    const at = r.sentAt ?? r.updatedAt;
    if (r.status === "failed") push(`sched:${r.id}`, at, r.oaId, r.lineUserId, "error", "予約メッセージの送信に失敗しました");
    else push(`sched:${r.id}`, at, r.oaId, r.lineUserId, "send", "予約メッセージを送信しました");
  }

  return mergeOwnerActivity(items, LIMIT);
}

/** 全ソースを新しい順にマージし先頭 limit 件を返す純関数（同時刻は id で安定化）。 */
export function mergeOwnerActivity(items: OwnerActivityItem[], limit = LIMIT): OwnerActivityItem[] {
  return [...items]
    .sort((a, b) => {
      const d = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}
