// src/app/api/works/route.ts
// GET  /api/works?oa_id=xxx — 作品一覧取得（_count: characters, phases, messages）
// POST /api/works            — 作品作成

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { createWorkSchema, workQuerySchema, formatZodErrors } from "@/lib/validations";
import { fetchWorkLatestActivityMap, latestOf } from "@/lib/latest-activity";
import { ZodError } from "zod";
import { activeCache, CACHE_KEY } from "@/lib/cache";
import { getCachedOaById } from "@/lib/oa-cache";
import { genRequestId, runWithRequestId, withTiming } from "@/lib/perf";
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
  publishStatus: string; sortOrder: number;
  liffEnabled?: boolean | null;
  systemCharacterId: string | null;
  welcomeMessage: string | null;
  readReceiptMode: string | null; readDelayMs: number | null;
  typingEnabled: boolean | null; typingMinMs: number | null; typingMaxMs: number | null;
  loadingEnabled: boolean | null; loadingThresholdMs: number | null;
  loadingMinSeconds: number | null; loadingMaxSeconds: number | null;
  createdAt: Date; updatedAt: Date;
}) {
  return {
    id:                  w.id,
    oa_id:               w.oaId,
    title:               w.title,
    description:         w.description,
    publish_status:      w.publishStatus,
    sort_order:          w.sortOrder,
    liff_enabled:        w.liffEnabled ?? true,
    system_character_id: w.systemCharacterId,
    welcome_message:     w.welcomeMessage,
    read_receipt_mode:    (w.readReceiptMode as import("@/types").ReadReceiptMode) ?? null,
    read_delay_ms:        w.readDelayMs ?? null,
    typing_enabled:       w.typingEnabled ?? null,
    typing_min_ms:        w.typingMinMs ?? null,
    typing_max_ms:        w.typingMaxMs ?? null,
    loading_enabled:      w.loadingEnabled ?? null,
    loading_threshold_ms: w.loadingThresholdMs ?? null,
    loading_min_seconds:  w.loadingMinSeconds ?? null,
    loading_max_seconds:  w.loadingMaxSeconds ?? null,
    created_at:          w.createdAt,
    updated_at:          w.updatedAt,
  };
}

// ── GET /api/works ───────────────────────────────
export const GET = withAuth(async (req, _ctx, user) =>
  runWithRequestId(genRequestId(), () => withTiming("api/works:GET", async () => {
  try {
    const { searchParams } = new URL(req.url);
    const query = workQuerySchema.parse({
      oa_id:          searchParams.get("oa_id")          ?? undefined,
      publish_status: searchParams.get("publish_status") ?? undefined,
    });

    // OA の存在確認 + ownerKey の事前取得 (後段の requireRole で再利用して Oa.findUnique を 1 回に集約)。
    // PR #160: prisma.oa.findUnique を getCachedOaById に置き換え。warm hit 時 ~5ms。
    // cache miss 時は内部で prisma.oa.findUnique が走り、TTL=60s で保存される。
    const oa = await withTiming("api/works:db:oa", () => getCachedOaById(query.oa_id));
    if (!oa) return notFound("OA");

    const check = await requireRole(query.oa_id, user.id, 'viewer', {
      preloadedOa: { ownerKey: oa.ownerKey },
    });
    if (!check.ok) return check.response;

    // Work.findMany と UserProgress.groupBy を並列化する。
    // groupBy は workIds に依存させず relation filter (where.work.oaId) を使うことで
    // works の結果を待たずに発行可能になり、直列 ~(1000+750)ms → 並列 ~max(1000,750)ms。
    // 結果は workId をキーに突き合わせるので、publish_status filter で works から
    // 除外された workId が progressGroups に含まれていても shape 側で参照されず無害。
    //
    // _count.userProgress { where: { isPreview: false } } は Work 件数分の per-work
    // サブクエリになる（本番で 1185ms）。同じ集計は progressGroups（groupBy）で取得して
    // いるため、Prisma include からは外して per-work サブクエリを削減する。
    // API レスポンスからは _count.userProgress を消さず、shape 側で progress_stats.total
    // から合成して返す（後方互換維持）。
    const [works, progressGroups] = await Promise.all([
      withTiming("api/works:db:list", () =>
        prisma.work.findMany({
          where: {
            oaId: query.oa_id,
            ...(query.publish_status !== undefined && { publishStatus: query.publish_status }),
          },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: {
            _count: {
              select: {
                characters: true,
                phases:     true,
                messages:   true,
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
        }),
      ),
      withTiming("api/works:db:progressGroups", () =>
        prisma.userProgress.groupBy({
          by:    ["workId", "reachedEnding"],
          where: { isPreview: false, work: { oaId: query.oa_id } },
          _count: { _all: true },
        }),
      ),
    ]);

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

    // 作品配下の「最新活動日時」（work + 配下 Phase/Message/Character/LIFF の max(updatedAt)）。
    // 作品カードの「更新日時」表示・ソートの共通基準にする。bounded 集計（この OA の workIds のみ）。
    const workLatest = await fetchWorkLatestActivityMap(works.map((w) => w.id));

    return await withTiming("api/works:shape", async () => ok(
      works.map((w) => {
        const ps    = progressMap[w.id] ?? { completed: 0, in_progress: 0 };
        const total = ps.completed + ps.in_progress;
        return {
          ...toResponse(w),
          // _count.userProgress は Prisma include から外したが、API レスポンス互換のため
          // ここで progress_stats.total と同値の値を合成して返す。
          // 既存 client は _count.userProgress を引き続き読めるが、新規は progress_stats.total を使う。
          _count: {
            ...w._count,
            userProgress: total,
          },
          // start フェーズが未作成の場合は null
          start_trigger: w.phases[0]?.startTrigger ?? null,
          // 作品配下の最新活動日時。子データが無ければ work.updatedAt ?? createdAt にフォールバック。
          latest_activity_at: (latestOf(workLatest.get(w.id), w.updatedAt, w.createdAt) ?? w.createdAt),
          progress_stats: {
            total,
            completed:   ps.completed,
            in_progress: ps.in_progress,
          },
        };
      })
    ));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("クエリパラメータが不正です", formatZodErrors(err));
    // Prisma 既知エラーは code / meta を含めて明示的にログする。
    // 特に P2022 (column does not exist) は本番 DB に migration が未適用な兆候なので
    // Vercel ログから一目で分かるようにする。
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      console.error(
        `[/api/works GET] Prisma error code=${err.code} message=${err.message}`,
        err.meta
      );
      if (err.code === "P2022") {
        // 「カラムが見つからない」= 本番 DB の schema が古い (migrate deploy 漏れ) の合図。
        // 一般 500 ではなく専用エラーで返してフロント側で気付きやすくする。
        return NextResponse.json(
          {
            success: false,
            error: {
              code:    "SCHEMA_OUT_OF_DATE",
              message: "DB スキーマと Prisma client が一致しません。`npx prisma migrate deploy` を本番 DB に適用してください。",
              hint:    err.meta?.column ? `不足カラム: ${String(err.meta.column)}` : undefined,
            },
          },
          { status: 500 }
        );
      }
    }
    return serverError(err);
  }
  }))
);

// ── POST /api/works ──────────────────────────────
export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json();
    const data = createWorkSchema.parse(body);

    // OA の存在確認 + ownerKey の事前取得 (= GET と同じ cache 経路)
    const oa = await getCachedOaById(data.oa_id);
    if (!oa) return notFound("OA");

    const check = await requireRole(data.oa_id, user.id, 'tester', {
      preloadedOa: { ownerKey: oa.ownerKey },
    });
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
                ? 'Basicプランでは作品を 1 件までしか作成できません。上位プランへのアップグレードをご検討ください。'
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
