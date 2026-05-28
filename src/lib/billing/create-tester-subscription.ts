// src/lib/billing/create-tester-subscription.ts
// OA 作成直後に tester プランの subscription を自動起票する共通 helper。
//
// 呼び出し元:
//   - POST /api/oas (新規 OA 作成)
//   - PATCH /api/admin/oa-onboarding/[id]（承認時の Oa 作成）
//
// 設計:
//   - fire-and-forget で呼ばれる前提。失敗時は OA 作成をブロックしない。
//   - tester プランが Plan シード未実行で見つからない場合は no-op（警告ログのみ）。

import { prisma } from "@/lib/prisma";

export async function createTesterSubscription(oaId: string): Promise<void> {
  const testerPlan = await prisma.plan.findUnique({ where: { name: "tester" } });
  if (!testerPlan) {
    console.warn(
      `[createTesterSubscription] tester plan not found — subscription skipped for oa=${oaId}. Run \`node prisma/seed.mjs\`.`
    );
    return;
  }
  const now = new Date();
  const end = new Date(now);
  end.setFullYear(end.getFullYear() + 1);
  await prisma.subscription.create({
    data: {
      oaId,
      planId:             testerPlan.id,
      status:             "trialing",
      currentPeriodStart: now,
      currentPeriodEnd:   end,
    },
  });
}
