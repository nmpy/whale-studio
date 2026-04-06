// src/app/api/works/route.ts
// GET  /api/works?oa_id=xxx — 作品一覧取得（_count: characters, phases, messages）
// POST /api/works            — 作品作成

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { createWorkSchema, workQuerySchema, formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";
import { activeCache, CACHE_KEY } from "@/lib/cache";
// trackOnboardingStep (OnboardingEvent write) は Phase 3 で停止済み
// OnboardingEvent テーブルへの書き込みを廃止し、OnboardingProgress のみを使用する
import { trackOnboardingProgress } from "@/lib/onboarding";

export const dynamic = "force-dynamic";
// ── 作品作成上限を取得 ─────────────────────────────────────────────────────
// 優先順位:
//   1. OA に紐付く Subscription.plan.maxWorks（存在する場合）
//   2. role ベースの fallback（tester = 1 件、それ以外 = -1 = 無制限）
//
// -1 は無制限を表す。subscription が存在しても plan.maxWorks=-1 なら無制限。
async function getWorkLimit(oaId: string, role: string): Promise<number> {
  const sub = await prisma.subscription.findUnique({
    where:   { oaId },
    include: { plan: { select: { maxWorks: true } } },
  });

  // Subscription + Plan が存在する場合はそちらを優先
  if (sub?.plan != null) {
    return sub.plan.maxWorks; // -1 = 無制限
  }

  // Subscription 未設定 → role ベース fallback
  if (role === "tester") return 1;
  return -1; // editor 以上は無制限
}

function toResponse(w: {
  id: string; oaId: string; title: string; description: string | null;
  publishStatus: string; sortOrder: number; systemCharacterId: string | null;
  welcomeMessage: string | null;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id:                  w.id,
    oa_id:               w.oaId,
    title:               w.title,
    description:         w.description,
    publish_status:      w.publishStatus,
    sort_order:          w.sortOrder,
    system_character_id: w.systemCharacterId,
    welcome_message:     w.welcomeMessage,
    created_at:          w.createdAt,
    updated_at:          w.updatedAt,
  };
}

// ── GET /api/works ───────────────────────────────
export const GET = withAuth(async (req, _ctx, user) => {
  try {
    const { searchParams } = new URL(req.url);
    const query = workQuerySchema.parse({
      oa_id:          searchParams.get("oa_id")          ?? undefined,
      publish_status: searchParams.get("publish_status") ?? undefined,
    });

    // OA の存在確認
    const oa = await prisma.oa.findUnique({ where: { id: query.oa_id } });
    if (!oa) return notFound("OA");

    const check = await requireRole(query.oa_id, user.id, 'viewer');
    if (!check.ok) return check.response;

    const works = await prisma.work.findMany({
      where: {
        oaId: query.oa_id,
        ...(query.publish_status !== undefined && { publishStatus: query.publish_status }),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        _count: {
          select: {
            characters:   true,
            phases:       true,
            messages:     true,
            // preview データを除外してプレイヤー実数を返す
            userProgress: { where: { isPreview: false } },
          },
        },
        // 開始トリガーを持つ start フェーズを1件取得。
        // 現在は作品ごとに start フェーズは1件想定だが、将来複数の
        // 開始トリガー（キーワード）に対応する場合は take を除去し、
        // フロント側で配列として受け取る形に変更する。
        phases: {
          where:   { phaseType: "start" },
          select:  { startTrigger: true },
          take:    1,
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    // プレイヤー進行情報（isPreview=false）を workId × reachedEnding で集計
    const workIds = works.map((w) => w.id);
    const progressGroups = workIds.length > 0
      ? await prisma.userProgress.groupBy({
          by:    ["workId", "reachedEnding"],
          where: { workId: { in: workIds }, isPreview: false },
          _count: { _all: true },
        })
      : [];

    // progressMap[workId] = { completed, in_progress }
    const progressMap: Record<string, { completed: number; in_progress: number }> = {};
    for (const g of progressGroups) {
      if (!progressMap[g.workId]) progressMap[g.workId] = { completed: 0, in_progress: 0 };
      if (g.reachedEnding) {
        progressMap[g.workId].completed    += g._count._all;
      } else {
        progressMap[g.workId].in_progress  += g._count._all;
      }
    }

    return ok(
      works.map((w) => {
        const ps = progressMap[w.id] ?? { completed: 0, in_progress: 0 };
        return {
          ...toResponse(w),
          _count:        w._count,
          // start フェーズが未作成の場合は null
          start_trigger: w.phases[0]?.startTrigger ?? null,
          progress_stats: {
            total:       (ps.completed + ps.in_progress),
            completed:   ps.completed,
            in_progress: ps.in_progress,
          },
        };
      })
    );
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です", formatZodErrors(err));
    return serverError(err);
  }
});

// ── POST /api/works ──────────────────────────────
export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json();
    const data = createWorkSchema.parse(body);

    // OA の存在確認
    const oa = await prisma.oa.findUnique({ where: { id: data.oa_id } });
    if (!oa) return notFound("OA");

    const check = await requireRole(data.oa_id, user.id, 'tester');
    if (!check.ok) return check.response;

    // 作品数上限チェック: subscription.plan.maxWorks 優先、未設定時は role ベース
    const workLimit = await getWorkLimit(data.oa_id, check.role);
    if (workLimit !== -1) {
      const existingCount = await prisma.work.count({ where: { oaId: data.oa_id } });
      if (existingCount >= workLimit) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code:    'TESTER_WORK_LIMIT', // 既存フロント互換のままにする
              message: workLimit === 1
                ? 'テスタープランでは作品を 1 件までしか作成できません。エディター以上にアップグレードしてください。'
                : `現在のプランでは作品を ${workLimit} 件まで作成できます。上位プランへのアップグレードをご検討ください。`,
            },
          },
          { status: 403 }
        );
      }
    }

    const work = await prisma.work.create({
      data: {
        oaId:          data.oa_id,
        title:         data.title,
        description:   data.description,
        publishStatus: data.publish_status,
        sortOrder:     data.sort_order,
      },
    });

    // グローバルフェーズを自動作成（全フェーズ共通メッセージ用）
    await prisma.phase.create({
      data: {
        workId:      work.id,
        phaseType:   "global",
        name:        "全フェーズ共通",
        description: "どのフェーズでも反応するメッセージ（ヒント・ヘルプ等）",
        sortOrder:   -1,
        isActive:    true,
      },
    });

    // active 状態で作成した場合はキャッシュを無効化
    if (work.publishStatus === "active") {
      await activeCache.delete(CACHE_KEY.work(work.oaId));
    }

    // オンボーディングステップ記録（fire-and-forget）
    // OnboardingProgress のみ記録（OnboardingEvent への write は Phase 3 で停止）
    trackOnboardingProgress({ userId: user.id, workId: work.id, step: "work_created" });

    return created(toResponse(work));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
