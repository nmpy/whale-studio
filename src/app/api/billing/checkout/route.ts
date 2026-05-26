// src/app/api/billing/checkout/route.ts
// POST /api/billing/checkout — 個人プラン用 Stripe Checkout Session の作成
//
// /pricing の「アップグレードする」ボタンから呼ばれる。
//
// 入力:
//   { plan: "basic" | "standard" | "pro" | "plus", oaId: string }
//
// 処理:
//   1. ユーザー認証 (withAuth)
//   2. OA への admin 権限確認 (requireRole)
//   3. plan → Stripe price ID マッピング取得。未設定なら 400「準備中」
//   4. Stripe Checkout Session を mode=subscription で作成
//   5. metadata に { oaId, userId, plan } を含める (= webhook で DB 反映に使う)
//   6. { url: session.url } を返す → クライアントが location.href = url で遷移
//
// 法人プランは別導線 (FeedbackModal) のため本エンドポイントは扱わない。

import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { withAuth } from "@/lib/auth";
import { ok, badRequest, serverError } from "@/lib/api-response";
import { getStripe, isStripeCheckoutConfigured } from "@/lib/stripe";
import { getPriceIdForPlan, getAppUrl } from "@/lib/stripe-prices";
import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { trackBillingEventLog } from "@/lib/billing-events";
import { PLAN_TIER, type PlanTier } from "@/lib/constants/plans";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  plan: z.enum([PLAN_TIER.basic, PLAN_TIER.standard, PLAN_TIER.pro, PLAN_TIER.plus]),
  oaId: z.string().min(1),
});

export const POST = withAuth(async (req: NextRequest, _ctx, user) => {
  if (!isStripeCheckoutConfigured()) {
    return badRequest(
      "Stripe が設定されていません。環境変数 STRIPE_SECRET_KEY を確認してください。",
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) return badRequest("リクエスト形式が不正です");
    return badRequest("リクエストの解析に失敗しました");
  }

  const { plan, oaId } = body;

  // ── 権限確認: admin 以上 (= owner/admin) ─────────────────────────
  const check = await requireRole(oaId, user.id, "admin");
  if (!check.ok) return check.response;

  // ── price ID 解決。未設定プラン → 400 「準備中」 ──────────────────
  const priceId = getPriceIdForPlan(plan as PlanTier);
  if (!priceId) {
    return badRequest("このプランは現在準備中です");
  }

  try {
    // 既存 Subscription から fromPlan を取得 (= 課金イベントログ用)
    const currentSub = await prisma.subscription.findUnique({
      where:   { oaId },
      include: { plan: { select: { name: true } } },
    });
    const fromPlan = currentSub?.plan?.name ?? null;

    // success/cancel URL: env > request origin の順
    const origin       = getAppUrl() ?? new URL(req.url).origin;
    const successUrl   = `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl    = `${origin}/pricing?checkout=cancelled`;

    const stripe  = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url:        successUrl,
      cancel_url:         cancelUrl,
      client_reference_id: oaId,
      metadata: {
        oaId,
        userId: user.id,
        plan,
      },
      subscription_data: {
        metadata: {
          oaId,
          userId: user.id,
          plan,
        },
      },
      locale: "ja",
    });

    if (!session.url) {
      return serverError(new Error("Stripe から checkout URL が返されませんでした"));
    }

    trackBillingEventLog({
      userId:   user.id,
      oaId,
      event:    "stripe_checkout_initiated",
      source:   "pricing",
      fromPlan: fromPlan ?? undefined,
      toPlan:   plan,
    }).catch(() => {});

    return ok({ url: session.url });
  } catch (err) {
    console.error("[/api/billing/checkout] Stripe API error:", err);
    return serverError(err);
  }
});
