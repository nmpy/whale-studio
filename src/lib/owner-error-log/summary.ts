// src/lib/owner-error-log/summary.ts
// エラーログ画面上部の 4 サマリー。全体サマリー（現在の一覧フィルタとは独立）。
//   - 直近7日の失敗 / 失敗率 は Phase 1 ダッシュボードと同一定義（failure-metrics を共有）。
//   - 未解決 は全期間の未解決件数。最多の原因は直近7日で件数最大の種別（0 件は "—"）。

import { prisma } from "@/lib/prisma";
import { getFailureMetrics } from "@/lib/owner-dashboard/failure-metrics";
import { periodStartUTC } from "./period";
import { countUnresolvedAll } from "./query";

export interface ErrorLogSummary {
  /** 直近7日の失敗件数。 */
  recent7dFailures: number;
  /** 全期間の未解決件数。 */
  unresolved: number;
  /** 直近7日の失敗率(%)（Phase 1 と同一定義）。 */
  failureRatePct: number;
  /** 直近7日で最多の原因（種別ラベル）。0 件は "—"。 */
  topCause: string;
}

export const EMPTY_SUMMARY: ErrorLogSummary = {
  recent7dFailures: 0, unresolved: 0, failureRatePct: 0, topCause: "—",
};

/** 最多の原因（種別）。同数は安定優先: Beacon > 現地 > メッセージ。全 0 は "—"。純関数。 */
export function pickTopCause(beaconFail: number, checkinFail: number, schedFail: number): string {
  const causes = [
    { label: "Beacon", count: beaconFail },
    { label: "現地チェックイン", count: checkinFail },
    { label: "メッセージ", count: schedFail },
  ];
  const top = causes.reduce((a, b) => (b.count > a.count ? b : a));
  return top.count > 0 ? top.label : "—";
}

export async function getErrorLogSummary(now: Date): Promise<ErrorLogSummary> {
  const start7d = periodStartUTC("7d", now)!;
  const works = await prisma.work.findMany({ select: { id: true } });
  const [fm, unresolved] = await Promise.all([
    getFailureMetrics(start7d, works.map((w) => w.id)),
    countUnresolvedAll(),
  ]);
  return {
    recent7dFailures: fm.failCount,
    unresolved,
    failureRatePct: fm.failureRatePct,
    topCause: pickTopCause(fm.beaconFail, fm.checkinFail, fm.schedFail),
  };
}
