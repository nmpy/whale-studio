// src/app/api/analytics/route.ts
// GET /api/analytics?work_id=xxx — 作品別プレイヤー分析

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { z } from "zod";

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

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({ work_id: searchParams.get("work_id") ?? undefined });
    if (!parsed.success) return badRequest("work_id が不正です");
    const { work_id } = parsed.data;

    const work = await prisma.work.findUnique({ where: { id: work_id } });
    if (!work) return notFound("作品");

    const [phases, allProgress] = await Promise.all([
      prisma.phase.findMany({
        where: { workId: work_id },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, sortOrder: true },
      }),
      prisma.userProgress.findMany({
        where: { workId: work_id },
        orderBy: { lastInteractedAt: "desc" },
      }),
    ]);

    // ヒント使用率: ヒントQRを1回以上タップしたユーザー数 / 総プレイヤー数
    // flags.hint_used === true が webhook によってセットされる
    const hintUsers = allProgress.filter((p) => {
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

    // ── Summary ──────────────────────────────────────────────
    const completed       = allProgress.filter((p) => p.reachedEnding);
    const totalPlayers    = allProgress.length;
    const totalClears     = completed.length;
    const clearRate       = totalPlayers > 0 ? round1((totalClears / totalPlayers) * 100) : 0;

    const playTimes           = allProgress.map((p) => calcPlayMin(p.createdAt, p.lastInteractedAt));
    const completedPlayTimes  = completed.map((p) => calcPlayMin(p.createdAt, p.lastInteractedAt));

    // ── Realtime ─────────────────────────────────────────────
    const currentlyPlaying = allProgress.filter(
      (p) => !p.reachedEnding && now.getTime() - p.lastInteractedAt.getTime() < activeMs
    ).length;
    const startedToday  = allProgress.filter((p) => p.createdAt >= todayStart).length;
    const clearedToday  = completed.filter((p) => p.lastInteractedAt >= todayStart).length;
    const sevenDaysAgo  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const activeLast7d  = allProgress.filter((p) => p.lastInteractedAt >= sevenDaysAgo).length;

    // ── Per-phase stats ───────────────────────────────────────
    const phaseStats = phases.map((phase) => {
      const phaseOrder = phase.sortOrder;

      const reached = allProgress.filter((p) => {
        if (p.reachedEnding) return true;
        const cur = phaseOrderMap.get(p.currentPhaseId ?? "");
        return cur !== undefined && cur >= phaseOrder;
      }).length;

      const currentlyAt = allProgress.filter(
        (p) => !p.reachedEnding && p.currentPhaseId === phase.id
      ).length;

      const cleared = allProgress.filter((p) => {
        if (p.reachedEnding) return true;
        const cur = phaseOrderMap.get(p.currentPhaseId ?? "");
        return cur !== undefined && cur > phaseOrder;
      }).length;

      const droppedOut = allProgress.filter((p) => {
        if (p.reachedEnding || p.currentPhaseId !== phase.id) return false;
        return now.getTime() - p.lastInteractedAt.getTime() >= dropoutMs;
      }).length;

      const stuck = allProgress.filter((p) => {
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
      const count = allProgress.filter((p) => {
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
    const stuckPlayers = allProgress
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
    const playerDetails = allProgress.slice(0, 100).map((p) => {
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
