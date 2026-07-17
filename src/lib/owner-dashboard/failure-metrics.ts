// src/lib/owner-dashboard/failure-metrics.ts
// スタジオ全体の「失敗 / エラー」件数・失敗率の**単一定義**。
// Phase 1 ダッシュボード（/admin/dashboard のエラー率カード・内訳）と Phase 2 エラーログ
// （/admin/error-log のサマリー）が同じ定義・同じクエリを共有するための共通サービス。
// 別々の計算式を実装しないこと。
//
// 失敗ソース（Phase 1 と同一）:
//   - BeaconEventLog.actionStatus = "failed"（created_at）
//   - CheckinAttempt.status != "success"（created_at・対象は既存 Work のみ）
//   - ScheduledLineMessage.status = "failed"（updated_at）
// 失敗率 = 失敗件数 / 対象処理件数 × 100（0 除算回避・小数第 1 位で丸め）。

import { prisma } from "@/lib/prisma";

/** 失敗とみなす CheckinAttempt（success 以外すべて。enum に cancel/processing 相当は無い）。 */
const FAIL_CHECKIN = { status: { not: "success" } as const };

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

export interface FailureMetrics {
  /** 原因（種別）別の失敗件数。 */
  beaconFail: number;
  checkinFail: number;
  schedFail: number;
  /** 失敗合計。 */
  failCount: number;
  /** 対象処理合計（失敗率の分母）。 */
  procCount: number;
  /** 失敗率(%)。0 除算回避・小数第 1 位。 */
  failureRatePct: number;
  /** 原因別 × アカウント別の内訳素材（表示名への変換は呼び出し側）。 */
  beaconFailByOa: { oaId: string; count: number }[];
  schedFailByOa: { oaId: string; count: number }[];
  checkinFailByWork: { workId: string; count: number }[];
}

/** 失敗率(%)。0 除算回避・小数第 1 位。純関数。 */
export function toFailureRatePct(failCount: number, procCount: number): number {
  return procCount > 0 ? Math.round((failCount / procCount) * 1000) / 10 : 0;
}

/**
 * pStart 以降の失敗 / 処理件数を集計する（Phase 1 と同一クエリ・同一定義）。
 * @param pStart 期間開始（UTC 絶対時刻。JST 日境界は呼び出し側で算出）
 * @param workIds 既存 Work の id 一覧（checkin 対象を既存 Work に限定するため）
 */
export async function getFailureMetrics(pStart: Date, workIds: string[]): Promise<FailureMetrics> {
  const hasWorks = workIds.length > 0;
  const [
    beaconFail, beaconTotal, checkinFail, checkinTotal, schedFail, schedTotal,
    beaconByOa, schedByOa, checkinByWork,
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
  return {
    beaconFail, checkinFail, schedFail, failCount, procCount,
    failureRatePct: toFailureRatePct(failCount, procCount),
    beaconFailByOa: beaconByOa.map((r) => ({ oaId: r.oaId, count: r._count._all })),
    schedFailByOa: schedByOa.map((r) => ({ oaId: r.oaId, count: r._count._all })),
    checkinFailByWork: checkinByWork.map((r) => ({ workId: r.workId, count: r._count._all })),
  };
}
