// src/lib/billing/create-tester-subscription.ts
// OA 作成直後に「7日トライアル」の subscription を自動起票する共通 helper。
//
// 呼び出し元:
//   - POST /api/oas (新規 OA 作成)
//   - PATCH /api/admin/oa-onboarding/[id]（承認時の Oa 作成）
//
// 仕様（β版 / トライアル方針）:
//   - 新規 personal OA に **7日トライアル**を付与（期限内は Pro Max 相当）。
//   - status="trialing" / grantType="trial" / plan="pro" / trialEndsAt=now+7日 /
//     externalId=null（Stripe 非連動）。currentPeriodEnd は trialEndsAt に揃える。
//   - business OA には付与しない（OA 作成時の usageType は personal が既定）。
//   - 失効後（trialEndsAt 経過）は feature gate 側で basic 相当にフォールバックする
//     （subscription-grant.effectiveTierFromSub）。
//
// 設計:
//   - fire-and-forget で呼ばれる前提。失敗時は OA 作成をブロックしない。
//   - pro プランが Plan シード未実行で見つからない場合は no-op（警告ログのみ）。
//   - 関数名は後方互換のため維持（実体は 7日トライアル付与）。

import { prisma } from "@/lib/prisma";

/** トライアル日数（7日）。 */
export const TRIAL_DAYS = 7;

export async function createTesterSubscription(oaId: string): Promise<void> {
  // business OA にはトライアルを付与しない（個人利用のみ）。
  const oa = await prisma.oa.findUnique({ where: { id: oaId }, select: { usageType: true } });
  if (oa && oa.usageType !== "personal") return;

  // 既に subscription がある場合は二重起票しない。
  const existing = await prisma.subscription.findUnique({ where: { oaId }, select: { id: true } });
  if (existing) return;

  const proPlan = await prisma.plan.findUnique({ where: { name: "pro" } });
  if (!proPlan) {
    console.warn(
      `[createTesterSubscription] pro plan not found — trial subscription skipped for oa=${oaId}. Run \`node prisma/seed.mjs\`.`,
    );
    return;
  }

  const now = new Date();
  const trialEnd = new Date(now);
  trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

  await prisma.subscription.create({
    data: {
      oaId,
      planId:             proPlan.id,
      status:             "trialing",
      grantType:          "trial",
      trialEndsAt:        trialEnd,
      currentPeriodStart: now,
      currentPeriodEnd:   trialEnd, // 既存 UI 互換のため trialEndsAt に揃える
    },
  });
}
