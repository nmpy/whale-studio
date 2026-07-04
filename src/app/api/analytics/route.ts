// src/app/api/analytics/route.ts
// GET /api/analytics?work_id=xxx — 作品別プレイヤー分析

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { parseAnalyticsRange, isWithinRange } from "@/lib/analytics-range";
import { z } from "zod";

export const dynamic = "force-dynamic";
const querySchema = z.object({
  work_id: z.string().uuid(),
});

function anonymize(lineUserId: string): string {
  const tail = lineUserId.slice(-4);
  return `U***${tail}`;
}

function calcPlayMin(createdAt: Date, lastInteractedAt: Date): number {
  return Math.max(0, (lastInteractedAt.getTime() - createdAt.getTime()) / 60000);
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const GET = withAuth(async (req: NextRequest, _ctx, user) => {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({ work_id: searchParams.get("work_id") ?? undefined });
    if (!parsed.success) return badRequest("work_id が不正です");
    const { work_id } = parsed.data;

    const work = await prisma.work.findUnique({ where: { id: work_id } });
    if (!work) return notFound("作品");

    // 認可: 作品が属する OA に対する閲覧権限（viewer 以上＝tester 含む）が必須。
    //   UI だけでなく API 直接アクセスでも他 OA/他作品の分析を読めないようにする。
    const check = await requireRole(work.oaId, user.id, "viewer");
    if (!check.ok) return check.response;

    // 表示期間フィルター（JST 基準）。未指定 / 不正は全期間（既定・現行の見え方を維持）。
    const range = parseAnalyticsRange(
      { range: searchParams.get("range"), from: searchParams.get("from"), to: searchParams.get("to") },
      new Date(),
    );

    const [phases, allProgress] = await Promise.all([
      prisma.phase.findMany({
        where: { workId: work_id },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, sortOrder: true },
      }),
      // 実プレイヤー行動のみを集計対象にする（プレビュー/疑似プレイ isPreview=true は除外）。
      //   元データは削除しない。where 条件で除外するだけ（解除＝再取得で復帰）。
      prisma.userProgress.findMany({
        where: { workId: work_id, isPreview: false },
        orderBy: { lastInteractedAt: "desc" },
      }),
    ]);

    // 期間フィルターは「対象期間に参加した（createdAt が期間内の）プレイヤー」を cohort として
    // summary / フェーズ別 / 離脱 / プレイヤー詳細 に適用する。全期間指定時は全 cohort（＝現行と同一）。
    // realtime（現在プレイ中/本日/直近7日）は "現在の状況" を表すため期間フィルターを掛けない。
    const cohort = (range.from || range.to)
      ? allProgress.filter((p) => isWithinRange(p.createdAt, range))
      : allProgress;

    // ヒント使用率: ヒントQRを1回以上タップしたユーザー数 / 総プレイヤー数（cohort ＝期間内参加者）
    // flags.hint_used === true が webhook によってセットされる
    const hintUsers = cohort.filter((p) => {
      try {
        const flags = JSON.parse(p.flags) as Record<string, unknown>;
        return flags?.hint_used === true;
      } catch {
        return false;
      }
    });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const activeMs   = 30 * 60 * 1000;   // 30 分
    const stuckMs    = 10 * 60 * 1000;   // 10 分
    const dropoutMs  = 24 * 60 * 60 * 1000; // 24 時間

    const phaseOrderMap = new Map(phases.map((p) => [p.id, p.sortOrder]));
    const phaseNameMap  = new Map(phases.map((p) => [p.id, p.name]));

    // ── Summary（cohort ＝対象期間に参加したプレイヤー）──────────
    const completed       = cohort.filter((p) => p.reachedEnding);
    const totalPlayers    = cohort.length;
    const totalClears     = completed.length;
    const clearRate       = totalPlayers > 0 ? round1((totalClears / totalPlayers) * 100) : 0;

    const playTimes           = cohort.map((p) => calcPlayMin(p.createdAt, p.lastInteractedAt));
    const completedPlayTimes  = completed.map((p) => calcPlayMin(p.createdAt, p.lastInteractedAt));

    // ── Realtime（"現在の状況"。期間フィルターは掛けず isPreview=false 全体で見る）──
    const currentlyPlaying = allProgress.filter(
      (p) => !p.reachedEnding && now.getTime() - p.lastInteractedAt.getTime() < activeMs
    ).length;
    const startedToday  = allProgress.filter((p) => p.createdAt >= todayStart).length;
    const clearedToday  = allProgress.filter((p) => p.reachedEnding && p.lastInteractedAt >= todayStart).length;
    const sevenDaysAgo  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const activeLast7d  = allProgress.filter((p) => p.lastInteractedAt >= sevenDaysAgo).length;

    // ── Per-phase stats ───────────────────────────────────────
    const phaseStats = phases.map((phase) => {
      const phaseOrder = phase.sortOrder;

      const reached = cohort.filter((p) => {
        if (p.reachedEnding) return true;
        const cur = phaseOrderMap.get(p.currentPhaseId ?? "");
        return cur !== undefined && cur >= phaseOrder;
      }).length;

      const currentlyAt = cohort.filter(
        (p) => !p.reachedEnding && p.currentPhaseId === phase.id
      ).length;

      const cleared = cohort.filter((p) => {
        if (p.reachedEnding) return true;
        const cur = phaseOrderMap.get(p.currentPhaseId ?? "");
        return cur !== undefined && cur > phaseOrder;
      }).length;

      const droppedOut = cohort.filter((p) => {
        if (p.reachedEnding || p.currentPhaseId !== phase.id) return false;
        return now.getTime() - p.lastInteractedAt.getTime() >= dropoutMs;
      }).length;

      const stuck = cohort.filter((p) => {
        if (p.reachedEnding || p.currentPhaseId !== phase.id) return false;
        const elapsed = now.getTime() - p.lastInteractedAt.getTime();
        return elapsed >= stuckMs && elapsed < dropoutMs;
      }).length;

      return {
        phase_id:    phase.id,
        phase_name:  phase.name,
        sort_order:  phaseOrder,
        reached,
        currently_at: currentlyAt,
        cleared,
        dropped_out:  droppedOut,
        stuck,
        clear_rate:   reached > 0 ? round1((cleared / reached) * 100) : 0,
      };
    });

    // ── Dropout distribution ──────────────────────────────────
    const rawDropout = phases.map((phase) => {
      const count = cohort.filter((p) => {
        if (p.reachedEnding || p.currentPhaseId !== phase.id) return false;
        return now.getTime() - p.lastInteractedAt.getTime() >= dropoutMs;
      }).length;
      return { phase_id: phase.id, phase_name: phase.name, dropout_count: count };
    }).filter((d) => d.dropout_count > 0);

    const totalDropouts  = rawDropout.reduce((s, d) => s + d.dropout_count, 0);
    const dropoutRate    = totalPlayers > 0 ? round1((totalDropouts  / totalPlayers) * 100) : 0;
    const hintUsageRate  = totalPlayers > 0 ? round1((hintUsers.length / totalPlayers) * 100) : 0;
    const dropoutDist   = rawDropout.map((d) => ({
      ...d,
      dropout_pct: totalDropouts > 0 ? round1((d.dropout_count / totalDropouts) * 100) : 0,
    }));

    // ── Stuck players ─────────────────────────────────────────
    const stuckPlayers = cohort
      .filter((p) => {
        if (p.reachedEnding) return false;
        const elapsed = now.getTime() - p.lastInteractedAt.getTime();
        return elapsed >= stuckMs && elapsed < dropoutMs;
      })
      .map((p) => ({
        anonymous_id:        anonymize(p.lineUserId),
        current_phase_name:  phaseNameMap.get(p.currentPhaseId ?? "") ?? "不明",
        stuck_minutes:       Math.round((now.getTime() - p.lastInteractedAt.getTime()) / 60000),
        last_active:         p.lastInteractedAt.toISOString(),
      }));

    // ── Player details (最新100件) ────────────────────────────
    const playerDetails = cohort.slice(0, 100).map((p) => {
      const elapsed = now.getTime() - p.lastInteractedAt.getTime();
      let status: "active" | "stuck" | "dropped" | "completed";
      if (p.reachedEnding)         status = "completed";
      else if (elapsed < activeMs) status = "active";
      else if (elapsed < dropoutMs) status = "stuck";
      else                          status = "dropped";

      return {
        anonymous_id:        anonymize(p.lineUserId),
        current_phase_name:  p.reachedEnding
          ? "クリア済み"
          : (phaseNameMap.get(p.currentPhaseId ?? "") ?? "不明"),
        play_time_min: Math.round(calcPlayMin(p.createdAt, p.lastInteractedAt)),
        last_active:   p.lastInteractedAt.toISOString(),
        reached_ending: p.reachedEnding,
        status,
      };
    });

    return ok({
      work: { id: work.id, title: work.title },
      // 適用された表示期間（UI の「表示期間」ラベルと突き合わせ用）。null = 無制限。
      range: {
        key:  range.key,
        from: range.from ? range.from.toISOString() : null,
        to:   range.to ? range.to.toISOString() : null,
      },
      summary: {
        total_players:               totalPlayers,
        total_clears:                totalClears,
        clear_rate:                  clearRate,
        dropout_rate:                dropoutRate,
        hint_usage_rate:             hintUsageRate,
        avg_play_time_min:           round1(avg(playTimes)),
        median_play_time_min:        round1(median(playTimes)),
        min_play_time_min:           playTimes.length > 0 ? round1(Math.min(...playTimes)) : 0,
        max_play_time_min:           playTimes.length > 0 ? round1(Math.max(...playTimes)) : 0,
        avg_completed_play_time_min: round1(avg(completedPlayTimes)),
      },
      realtime: {
        currently_playing: currentlyPlaying,
        started_today:     startedToday,
        cleared_today:     clearedToday,
        active_last_7d:    activeLast7d,
      },
      phase_stats:          phaseStats,
      dropout_distribution: dropoutDist,
      stuck_players:        stuckPlayers,
      player_details:       playerDetails,
    });
  } catch (err) {
    return serverError(err);
  }
});
