// src/lib/owner-dashboard/aggregate.ts
// スタジオ全体ダッシュボード（プラットフォームオーナー向け）のサーバー側集約サービス。
//   - オーナーが閲覧可能な全 Oa を横断集計する（platform owner は全アカウント）。
//   - 読み取り専用。DB/schema 変更なし。既存の構造化ログ・UserProgress を集計するのみ。
//   - 集計はサーバーで実施し、クライアントへ巨大な未加工ログを渡さない。
//   - 日付境界は Asia/Tokyo（JST）。期間依存の指標は period に従う。
//
// 集計定義（実装上の定義をここに明示）:
//   - accounts / publishedAccounts : Oa 総数 / publishStatus==="active"
//   - totalPlayers : 全作品横断の distinct lineUserId（isPreview=false）。account 別内訳は
//     「作品ごとの参加数の合計（同一プレイヤーが複数作品に居れば重複）」＝プレイ数ベースで、
//     全体の distinct とは基準が異なる（cross-account distinct は UserProgress に oaId が無く高コストのため）。
//   - totalWorks / publishedWorks : Work 総数 / publishStatus==="active"
//   - joinedToday / joinedYesterday : 初回参加(min createdAt) が JST 当日 / 前日 の distinct プレイヤー
//   - clearRatePct : distinct(reachedEnding) / distinct(total)（加重・全期間）
//   - failureRatePct : 期間内の 失敗件数 / 対象処理件数 × 100（下記ソース。0除算回避）
//   - daily : 期間内の JST 日別 新規プレイヤー数

import { prisma } from "@/lib/prisma";
import { accountColor } from "./account-color";

export type DashboardPeriod = "7d" | "30d" | "month";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** JST 日境界のユーティリティ（UTC の絶対時刻を返す）。 */
function jstDayStartUTC(now: Date, deltaDays = 0): Date {
  const j = new Date(now.getTime() + JST_OFFSET_MS);
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + deltaDays) - JST_OFFSET_MS);
}
function jstMonthStartUTC(now: Date): Date {
  const j = new Date(now.getTime() + JST_OFFSET_MS);
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), 1) - JST_OFFSET_MS);
}
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** 期間の開始（JST）。今日を含む。 */
function periodStart(period: DashboardPeriod, now: Date): Date {
  if (period === "month") return jstMonthStartUTC(now);
  return jstDayStartUTC(now, period === "30d" ? -29 : -6);
}

/** 期間内の JST 日別バケット（古い順）。 */
function dailyBuckets(period: DashboardPeriod, now: Date): { date: string; label: string; start: number; end: number }[] {
  const start = periodStart(period, now);
  const todayStart = jstDayStartUTC(now, 0);
  const out: { date: string; label: string; start: number; end: number }[] = [];
  let cur = start.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  // 上限を設けて無限ループを防ぐ（最大 40 日）。
  for (let i = 0; i < 40 && cur <= todayStart.getTime(); i++) {
    const wall = new Date(cur + JST_OFFSET_MS);
    out.push({
      date: `${wall.getUTCFullYear()}-${String(wall.getUTCMonth() + 1).padStart(2, "0")}-${String(wall.getUTCDate()).padStart(2, "0")}`,
      label: WEEKDAY_JA[wall.getUTCDay()],
      start: cur, end: cur + dayMs,
    });
    cur += dayMs;
  }
  return out;
}

export interface OwnerDashboardData {
  period: DashboardPeriod;
  summary: {
    accounts: number; publishedAccounts: number;
    totalPlayers: number; totalWorks: number; publishedWorks: number;
    joinedToday: number; joinedYesterday: number;
    clearRatePct: number;
    failureRatePct: number; failCount: number; procCount: number;
  };
  errorBreakdown: {
    total: number;
    rows: { oaId: string; accountName: string; cause: string; count: number; pct: number }[];
  };
  daily: { date: string; label: string; count: number }[];
  accountBreakdown: { oaId: string; name: string; players: number; pct: number }[];
  accountTable: {
    oaId: string; name: string; publishStatus: string;
    players: number; works: number; latestWorkTitle: string | null;
    latestActivityAt: string | null; href: string;
  }[];
}

const FAIL_CHECKIN = { status: { not: "success" } as const };

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

export async function getOwnerDashboard(period: DashboardPeriod, now: Date): Promise<OwnerDashboardData> {
  const pStart = periodStart(period, now);
  const todayStart = jstDayStartUTC(now, 0);
  const yesterdayStart = jstDayStartUTC(now, -1);

  // ── アカウント・作品（全件・小さな select）──
  const [oas, works] = await Promise.all([
    safe(prisma.oa.findMany({ select: { id: true, title: true, publishStatus: true, createdAt: true, updatedAt: true } }), []),
    safe(prisma.work.findMany({ select: { id: true, oaId: true, title: true, publishStatus: true, createdAt: true, updatedAt: true } }), []),
  ]);
  const oaById = new Map(oas.map((o) => [o.id, o]));
  const workById = new Map(works.map((w) => [w.id, w]));
  const accounts = oas.length;
  const publishedAccounts = oas.filter((o) => o.publishStatus === "active").length;
  const totalWorks = works.length;
  const publishedWorks = works.filter((w) => w.publishStatus === "active").length;

  // ── プレイヤー（distinct / per-work / 初回参加）──
  const baseWhere = { isPreview: false };
  const [distinctPlayers, distinctCleared, perWork, firstJoins] = await Promise.all([
    safe(prisma.userProgress.groupBy({ by: ["lineUserId"], where: baseWhere }), [] as { lineUserId: string }[]),
    safe(prisma.userProgress.groupBy({ by: ["lineUserId"], where: { ...baseWhere, reachedEnding: true } }), [] as { lineUserId: string }[]),
    safe(prisma.userProgress.groupBy({ by: ["workId"], where: baseWhere, _count: { _all: true } }), [] as { workId: string; _count: { _all: number } }[]),
    safe(prisma.userProgress.groupBy({ by: ["lineUserId"], where: baseWhere, _min: { createdAt: true } }), [] as { lineUserId: string; _min: { createdAt: Date | null } }[]),
  ]);
  const totalPlayers = distinctPlayers.length;
  const cleared = distinctCleared.length;
  const clearRatePct = totalPlayers > 0 ? Math.round((cleared / totalPlayers) * 100) : 0;

  const firstAts = firstJoins.map((r) => r._min.createdAt).filter((d): d is Date => !!d);
  const joinedToday = firstAts.filter((d) => d.getTime() >= todayStart.getTime()).length;
  const joinedYesterday = firstAts.filter((d) => d.getTime() >= yesterdayStart.getTime() && d.getTime() < todayStart.getTime()).length;

  // 日別新規（期間）
  const buckets = dailyBuckets(period, now);
  const firstTimes = firstAts.map((d) => d.getTime());
  const daily = buckets.map((b) => ({ date: b.date, label: b.label, count: firstTimes.filter((t) => t >= b.start && t < b.end).length }));

  // アカウント別プレイヤー（per-work 合計を oaId へ集約＝プレイ数ベース）
  const playersByOa = new Map<string, number>();
  for (const r of perWork) {
    const oaId = workById.get(r.workId)?.oaId;
    if (oaId) playersByOa.set(oaId, (playersByOa.get(oaId) ?? 0) + r._count._all);
  }
  const worksByOa = new Map<string, number>();
  for (const w of works) worksByOa.set(w.oaId, (worksByOa.get(w.oaId) ?? 0) + 1);
  const sumPlays = [...playersByOa.values()].reduce((a, b) => a + b, 0);
  const accountBreakdown = oas
    .map((o) => ({ oaId: o.id, name: o.title, players: playersByOa.get(o.id) ?? 0, pct: sumPlays > 0 ? Math.round(((playersByOa.get(o.id) ?? 0) / sumPlays) * 100) : 0 }))
    .sort((a, b) => b.players - a.players || a.oaId.localeCompare(b.oaId));

  // 最新の作品（アカウント別）— works から算出（N+1 なし）
  const latestWorkByOa = new Map<string, { title: string; at: Date }>();
  for (const w of works) {
    const at = w.updatedAt ?? w.createdAt;
    const cur = latestWorkByOa.get(w.oaId);
    if (!cur || at.getTime() > cur.at.getTime()) latestWorkByOa.set(w.oaId, { title: w.title, at });
  }
  const accountTable = oas
    .map((o) => {
      const lw = latestWorkByOa.get(o.id);
      const latest = [o.updatedAt, lw?.at].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? o.createdAt;
      return {
        oaId: o.id, name: o.title, publishStatus: o.publishStatus,
        players: playersByOa.get(o.id) ?? 0, works: worksByOa.get(o.id) ?? 0,
        latestWorkTitle: lw?.title ?? null,
        latestActivityAt: latest ? latest.toISOString() : null,
        href: `/oas/${o.id}/works`,
      };
    })
    .sort((a, b) => (b.players - a.players) || a.oaId.localeCompare(b.oaId));

  // ── 失敗/エラー（期間内・構造化ログ）──
  const workIds = works.map((w) => w.id);
  const hasWorks = workIds.length > 0;
  const [
    beaconFail, beaconTotal, checkinFail, checkinTotal, schedFail, schedTotal,
    beaconFailByOa, schedFailByOa, checkinFailByWork,
  ] = await Promise.all([
    safe(prisma.beaconEventLog.count({ where: { actionStatus: "failed", createdAt: { gte: pStart } } }), 0),
    safe(prisma.beaconEventLog.count({ where: { createdAt: { gte: pStart } } }), 0),
    hasWorks ? safe(prisma.checkinAttempt.count({ where: { workId: { in: workIds }, ...FAIL_CHECKIN, createdAt: { gte: pStart } } }), 0) : Promise.resolve(0),
    hasWorks ? safe(prisma.checkinAttempt.count({ where: { workId: { in: workIds }, createdAt: { gte: pStart } } }), 0) : Promise.resolve(0),
    safe(prisma.scheduledLineMessage.count({ where: { status: "failed", updatedAt: { gte: pStart } } }), 0),
    safe(prisma.scheduledLineMessage.count({ where: { status: { in: ["failed", "sent"] }, updatedAt: { gte: pStart } } }), 0),
    safe(prisma.beaconEventLog.groupBy({ by: ["oaId"], where: { actionStatus: "failed", createdAt: { gte: pStart } }, _count: { _all: true } }), [] as { oaId: string; _count: { _all: number } }[]),
    safe(prisma.scheduledLineMessage.groupBy({ by: ["oaId"], where: { status: "failed", updatedAt: { gte: pStart } }, _count: { _all: true } }), [] as { oaId: string; _count: { _all: number } }[]),
    hasWorks ? safe(prisma.checkinAttempt.groupBy({ by: ["workId"], where: { workId: { in: workIds }, ...FAIL_CHECKIN, createdAt: { gte: pStart } }, _count: { _all: true } }), [] as { workId: string; _count: { _all: number } }[]) : Promise.resolve([] as { workId: string; _count: { _all: number } }[]),
  ]);

  const failCount = beaconFail + checkinFail + schedFail;
  const procCount = beaconTotal + checkinTotal + schedTotal;
  const failureRatePct = procCount > 0 ? Math.round((failCount / procCount) * 1000) / 10 : 0;

  // 原因別×アカウント別の内訳（表示名に変換）
  const causeRows: { oaId: string; accountName: string; cause: string; count: number }[] = [];
  const nameOf = (oaId: string) => oaById.get(oaId)?.title ?? "不明なアカウント";
  for (const r of beaconFailByOa) causeRows.push({ oaId: r.oaId, accountName: nameOf(r.oaId), cause: "Beacon 検知", count: r._count._all });
  for (const r of schedFailByOa) causeRows.push({ oaId: r.oaId, accountName: nameOf(r.oaId), cause: "メッセージ送信", count: r._count._all });
  const checkinByOa = new Map<string, number>();
  for (const r of checkinFailByWork) {
    const oaId = workById.get(r.workId)?.oaId;
    if (oaId) checkinByOa.set(oaId, (checkinByOa.get(oaId) ?? 0) + r._count._all);
  }
  for (const [oaId, count] of checkinByOa) causeRows.push({ oaId, accountName: nameOf(oaId), cause: "現地チェックイン", count });
  causeRows.sort((a, b) => b.count - a.count || a.oaId.localeCompare(b.oaId));
  const errorBreakdown = {
    total: failCount,
    rows: causeRows.map((r) => ({ ...r, pct: failCount > 0 ? Math.round((r.count / failCount) * 100) : 0 })),
  };

  return {
    period,
    summary: { accounts, publishedAccounts, totalPlayers, totalWorks, publishedWorks, joinedToday, joinedYesterday, clearRatePct, failureRatePct, failCount, procCount },
    errorBreakdown,
    daily,
    accountBreakdown,
    accountTable,
  };
}

/** クエリ文字列の period を正規化（既定 7d）。 */
export function normalizePeriod(v: unknown): DashboardPeriod {
  return v === "30d" || v === "month" ? v : "7d";
}

// account 別内訳の表示色（純関数の再輸出）。
export { accountColor };
