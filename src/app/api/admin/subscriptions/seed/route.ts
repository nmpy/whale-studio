// src/app/api/admin/subscriptions/seed/route.ts
// POST /api/admin/subscriptions/seed
//
// 既存 OA のうち subscription を持たないものに
// tester プランの初期 subscription を一括作成する。
//
// 用途: Phase 3 移行時の一回性バッチ操作（冪等）。
//       以後は OA 作成時に自動で subscription を作成する運用を想定。
//
// 権限: platform admin のみ

import { prisma }            from "@/lib/prisma";
import { ok, serverError }   from "@/lib/api-response";
import { withPlatformAdmin } from "@/lib/with-platform-admin";

export const POST = withPlatformAdmin(async (_req, _ctx, _user) => {
  try {
    // tester プランを取得（seed 済みであること前提）
    const testerPlan = await prisma.plan.findUnique({ where: { name: "tester" } });
    if (!testerPlan) {
      return ok({
        ok:      false,
        message: "tester プランが存在しません。先に npm run db:seed を実行してください。",
        created: 0,
      });
    }

    // subscription 未設定の OA を全件取得
    const oasWithoutSub = await prisma.oa.findMany({
      where:  { subscription: null },
      select: { id: true },
    });

    if (oasWithoutSub.length === 0) {
      return ok({ ok: true, message: "対象 OA はありません（全 OA に subscription 設定済み）", created: 0 });
    }

    // 現在から 1 年後を期間終了とするトライアル subscription を一括作成
    const now        = new Date();
    const oneYearOut = new Date(now);
    oneYearOut.setFullYear(oneYearOut.getFullYear() + 1);

    const results = await Promise.allSettled(
      oasWithoutSub.map((oa) =>
        prisma.subscription.create({
          data: {
            oaId:               oa.id,
            planId:             testerPlan.id,
            status:             "trialing",
            currentPeriodStart: now,
            currentPeriodEnd:   oneYearOut,
          },
        })
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed    = results.filter((r) => r.status === "rejected").length;

    return ok({
      ok:      true,
      message: `${succeeded} 件の subscription を作成しました${failed > 0 ? `（${failed} 件失敗）` : ""}`,
      created: succeeded,
      failed,
    });
  } catch (err) {
    return serverError(err);
  }
});
