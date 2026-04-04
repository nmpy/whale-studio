// src/app/api/dashboard/route.ts
// GET /api/dashboard?work_id=xxx[&page=1&limit=50]
//
// 作品ごとのプレイ進行状況ダッシュボードデータを返す。
//
// レスポンス構成:
//   - work         : 作品情報
//   - stats        : 集計サマリー（総数・進行中・エンディング到達数・到達率）
//   - phase_distribution  : フェーズ別ユーザー到達数
//   - ending_distribution : エンディング別到達数
//   - users        : UserProgress 一覧（ページネーション付き）
//   - pagination   : ページ情報

import { withAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { formatZodErrors } from "@/lib/validations";
import { safeParseFlags } from "@/lib/runtime";
import { z, ZodError } from "zod";

export const dynamic = "force-dynamic";
const dashboardQuerySchema = z.object({
  work_id: z.string().uuid({ message: "work_id は有効な UUID を指定してください" }),
  page:    z.coerce.number().int().min(1).default(1),
  limit:   z.coerce.number().int().min(1).max(200).default(50),
});

export const GET = withAuth(async (req) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = dashboardQuerySchema.parse({
      work_id: searchParams.get("work_id") ?? undefined,
      page:    searchParams.get("page")    ?? undefined,
      limit:   searchParams.get("limit")   ?? undefined,
    });

    // ── 作品確認 ──────────────────────────────────
    const work = await prisma.work.findUnique({
      where:  { id: query.work_id },
      select: { id: true, title: true, publishStatus: true },
    });
    if (!work) return notFound("作品");

    // ── 集計クエリ（並列実行） ─────────────────────
    const [
      totalUsers,
      reachedEndingCount,
      phaseGroupsRaw,
      endingGroupsRaw,
    ] = await Promise.all([
      // 総ユーザー数
      prisma.userProgress.count({ where: { workId: query.work_id } }),

      // エンディング到達数
      prisma.userProgress.count({
        where: { workId: query.work_id, reachedEnding: true },
      }),

      // フェーズ別ユーザー数（currentPhaseId でグループ化）
      prisma.userProgress.groupBy({
        by:    ["currentPhaseId"],
        where: { workId: query.work_id },
        _count: { id: true },
      }),

      // エンディング別到達数（reachedEnding=true のユーザーのみ）
      prisma.userProgress.groupBy({
        by:    ["currentPhaseId"],
        where: { workId: query.work_id, reachedEnding: true },
        _count: { id: true },
      }),
    ]);

    const inProgressCount = totalUsers - reachedEndingCount;

    // ── フェーズ詳細の一括取得 ─────────────────────
    const allPhaseIds = [
      ...new Set([
        ...phaseGroupsRaw.map((g) => g.currentPhaseId).filter((id): id is string => id !== null),
        ...endingGroupsRaw.map((g) => g.currentPhaseId).filter((id): id is string => id !== null),
      ]),
    ];
    const phases = await prisma.phase.findMany({
      where:  { id: { in: allPhaseIds } },
      select: { id: true, name: true, phaseType: true, sortOrder: true },
    });
    const phaseMap = new Map(phases.map((p) => [p.id, p]));

    // ── フェーズ分布の整形 ─────────────────────────
    const PHASE_TYPE_ORDER: Record<string, number> = { start: 0, normal: 1, ending: 2 };

    const phaseDistribution = phaseGroupsRaw
      .map((g) => {
        const phase = g.currentPhaseId ? phaseMap.get(g.currentPhaseId) : null;
        return {
          phase_id:   g.currentPhaseId,
          phase_name: phase?.name    ?? null,
          phase_type: phase?.phaseType ?? null,
          sort_order: phase?.sortOrder ?? 9999,
          user_count: g._count.id,
        };
      })
      .sort((a, b) => {
        // phase_type 順 → sort_order 順 → null は末尾
        const aTypeOrder = a.phase_type ? (PHASE_TYPE_ORDER[a.phase_type] ?? 1) : 9;
        const bTypeOrder = b.phase_type ? (PHASE_TYPE_ORDER[b.phase_type] ?? 1) : 9;
        if (aTypeOrder !== bTypeOrder) return aTypeOrder - bTypeOrder;
        return a.sort_order - b.sort_order;
      });

    // ── エンディング別分布の整形 ───────────────────
    const endingDistribution = endingGroupsRaw
      .filter((g) => g.currentPhaseId !== null)
      .map((g) => ({
        phase_id:   g.currentPhaseId!,
        phase_name: phaseMap.get(g.currentPhaseId!)?.name ?? "（削除済みフェーズ）",
        user_count: g._count.id,
      }))
      .sort((a, b) => b.user_count - a.user_count);

    // ── UserProgress 一覧（ページネーション） ────────
    const skip  = (query.page - 1) * query.limit;
    const users = await prisma.userProgress.findMany({
      where:   { workId: query.work_id },
      include: {
        currentPhase: { select: { id: true, name: true, phaseType: true } },
      },
      orderBy: { lastInteractedAt: "desc" },
      skip,
      take: query.limit,
    });

    return ok({
      work: {
        id:             work.id,
        title:          work.title,
        publish_status: work.publishStatus,
      },
      stats: {
        total_users:     totalUsers,
        in_progress:     inProgressCount,
        reached_ending:  reachedEndingCount,
        completion_rate: totalUsers > 0
          ? Math.round((reachedEndingCount / totalUsers) * 100)
          : 0,
      },
      phase_distribution:  phaseDistribution,
      ending_distribution: endingDistribution,
      users: users.map((u) => ({
        id:                 u.id,
        line_user_id:       u.lineUserId,
        current_phase_id:   u.currentPhaseId,
        current_phase_name: u.currentPhase?.name     ?? null,
        current_phase_type: u.currentPhase?.phaseType ?? null,
        reached_ending:     u.reachedEnding,
        flags:              safeParseFlags(u.flags),
        last_interacted_at: u.lastInteractedAt.toISOString(),
        created_at:         u.createdAt.toISOString(),
        updated_at:         u.updatedAt.toISOString(),
      })),
      pagination: {
        total: totalUsers,
        page:  query.page,
        limit: query.limit,
        pages: Math.ceil(totalUsers / query.limit),
      },
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です", formatZodErrors(err));
    return serverError(err);
  }
});
