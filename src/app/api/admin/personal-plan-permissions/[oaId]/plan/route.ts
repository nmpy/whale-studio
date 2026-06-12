// src/app/api/admin/personal-plan-permissions/[oaId]/plan/route.ts
// POST /api/admin/personal-plan-permissions/[oaId]/plan — 個人利用 OA のプランを手動変更
//
// 安全方針（重要）:
//   - これは「運営による手動付与」。Stripe の課金状態は自動変更しない（Stripe API を呼ばない）。
//   - Subscription.externalId が設定済み（= Stripe 連動）の場合は 409 で拒否する
//     （手動で planId を変えると Stripe と desync するため）。externalId=null の
//     手動 / seed サブスクのみ planId を変更する。
//   - 委託プラン (delegated) は法人向けのため、ここでは選択不可（basic/standard/plus/pro のみ）。
//   - 対象は usageType=personal の OA のみ。
//
// 権限: platform admin 以外は 404 で秘匿。未ログインは withAuth が 401。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, conflict, unprocessable, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";
import { mapPlanNameToTier, PLAN_LABELS } from "@/lib/constants/plans";
import { z, ZodError } from "zod";

// 個人プラン権限で選べるのは「β版」+ 個人 4 ティア（delegated は法人向けで除外）。
//   "beta"                       → β版（無期限・Pro Max 相当）
//   "basic"/"standard"/"plus"/"pro" → 通常の手動付与
const changePlanSchema = z.object({
  planTier: z.enum(["beta", "basic", "standard", "plus", "pro"]),
  note:     z.string().trim().max(500).optional(),
});

export const POST = withAuth<{ oaId: string }>(async (req: NextRequest, ctx, user) => {
  try {
    if (!isPlatformOwner(user.id)) return notFound("ページ");

    const oa = await prisma.oa.findUnique({
      where:  { id: ctx.params.oaId },
      select: { id: true, usageType: true, subscription: { select: { externalId: true } } },
    });
    if (!oa) return notFound("OA");

    // 個人利用 OA のみ対象（法人利用は法人プラン権限側で扱う）。
    if (oa.usageType !== "personal") {
      return unprocessable("法人利用 OA はこの画面では変更できません。", "NOT_PERSONAL_OA");
    }

    const body = await req.json();
    const data = changePlanSchema.parse(body);

    // Stripe 連動サブスクは手動変更不可（desync 防止）。
    if (oa.subscription?.externalId) {
      return conflict("このアカウントは外部決済（Stripe）と連動しているため、ここでは変更できません。");
    }

    // β版は plan=pro（Pro Max 相当）に解決。通常プランは name = planTier。
    const grantType: "beta" | null = data.planTier === "beta" ? "beta" : null;
    const planName  = data.planTier === "beta" ? "pro" : data.planTier;

    const plan = await prisma.plan.findUnique({ where: { name: planName }, select: { id: true, name: true } });
    if (!plan) {
      return badRequest(`プラン "${planName}" が見つかりません（Plan 未seed の可能性）。`);
    }

    const now = new Date();
    const oneYearOut = new Date(now);
    oneYearOut.setFullYear(oneYearOut.getFullYear() + 1);

    // 手動付与: planId 変更 + status=active（即時有効）。externalId は触らない（null のまま）。
    //   β版    → grantType=beta / trialEndsAt=null（無期限・期限切れにならない）
    //   通常    → grantType=null / trialEndsAt=null（β版/トライアル指定を解除）
    await prisma.subscription.upsert({
      where:  { oaId: oa.id },
      update: { planId: plan.id, status: "active", canceledAt: null, grantType, trialEndsAt: null },
      create: {
        oaId:               oa.id,
        planId:             plan.id,
        status:             "active",
        grantType,
        trialEndsAt:        null,
        currentPeriodStart: now,
        currentPeriodEnd:   oneYearOut,
      },
    });

    // 監査ログ（運営の手動付与を記録）。
    await prisma.adminAuditLog.create({
      data: {
        actorId:    user.id,
        action:     "update",
        resource:   "personal_plan",
        resourceId: oa.id,
      },
    }).catch(() => { /* 監査失敗は本処理を止めない */ });

    const tier = mapPlanNameToTier(plan.name);
    return ok({
      oa_id:      oa.id,
      plan_name:  plan.name,
      plan_tier:  tier,
      plan_label: grantType === "beta" ? `β版（${PLAN_LABELS.pro}相当）` : PLAN_LABELS[tier],
      grant_type: grantType,
      status:     "active",
      note:       data.note ?? null,
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です");
    return serverError(err);
  }
});
