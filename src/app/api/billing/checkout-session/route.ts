// src/app/api/billing/checkout-session/route.ts
// POST /api/billing/checkout-session — Stripe Checkout Session の作成
//
// 認証済みユーザーが editor プランへアップグレードするための
// Stripe Hosted Checkout セッション URL を返す。
//
// フロー:
//   1. ユーザー認証 + OA への admin 権限確認
//   2. 現在の Subscription から fromPlan を取得
//   3. Stripe Checkout Session を mode=subscription で作成
//   4. { url: session.url } を返す → クライアントが window.location.href = url でリダイレクト

import { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { withAuth }         from "@/lib/auth";
import { ok, badRequest, serverError } from "@/lib/api-response";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { requireRole } from "@/lib/rbac";
import { prisma }     from "@/lib/prisma";
import { buildPricingUrl } from "@/lib/pricing-url";
import { trackBillingEventLog } from "@/lib/billing-events";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** アップグレード対象の OA ID */
  oaId: z.string().min(1),
  /** キャンセル時に戻る pricing ページの source context（省略可） */
  source:    z.string().optional(),
  fromPlan:  z.string().optional(),
});

export const POST = withAuth(async (req: NextRequest, _ctx, user) => {
  // ── Stripe 設定チェック ──────────────────────────────────────────
  if (!isStripeConfigured()) {
    return badRequest("Stripe が設定されていません。環境変数 STRIPE_SECRET_KEY / STRIPE_EDITOR_PRICE_ID を確認してください。");
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) return badRequest("リクエスト形式が不正です");
    return badRequest("リクエストの解析に失敗しました");
  }

  const { oaId, source, fromPlan: bodyFromPlan } = body;

  // ── 権限確認（admin 以上 = owner/admin） ─────────────────────────
  const check = await requireRole(oaId, user.id, "admin");
  if (!check.ok) return check.response;

  try {
    // ── 現在のサブスクリプション + fromPlan 取得 ──────────────────
    const currentSub = await prisma.subscription.findUnique({
      where:   { oaId },
      include: { plan: { select: { name: true } } },
    });
    const fromPlan = bodyFromPlan ?? currentSub?.plan?.name ?? "tester";

    // ── 遷移先 URL の組み立て ────────────────────────────────────
    const origin = new URL(req.url).origin;

    const successUrl = `${origin}/oas/${oaId}/settings?billing=success`;
    const cancelUrl  = `${origin}${buildPricingUrl({
      source:   source ?? "checkout",
      from:     fromPlan,
      to:       "editor",
      oaId,
    })}&canceled=1`;

    // ── Stripe Checkout Session 作成 ────────────────────────────
    const stripe  = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{
        price:    process.env.STRIPE_EDITOR_PRICE_ID!,
        quantity: 1,
      }],
      success_url: successUrl,
      cancel_url:  cancelUrl,
      // セッション自体のメタデータ: Webhook の checkout.session.completed で参照
      metadata: {
        oaId,
        userId:   user.id,
        fromPlan,
        toPlan:   "editor",
      },
      // Stripe サブスクリプションにも同じメタデータを付与
      // → subscription.updated Webhook でも oaId / userId を参照可能
      subscription_data: {
        metadata: {
          oaId,
          userId: user.id,
        },
      },
      // 言語ロケール（日本向け）
      locale: "ja",
    });

    if (!session.url) {
      return serverError(new Error("Stripe から checkout URL が返されませんでした"));
    }

    // ── 課金イベントログ（fire-and-forget） ────────────────────
    trackBillingEventLog({
      userId:   user.id,
      oaId,
      event:    "stripe_checkout_initiated",
      source:   source,
      fromPlan,
      toPlan:   "editor",
    }).catch(() => {});

    return ok({ url: session.url });
  } catch (err) {
    console.error("[checkout-session] Stripe API error:", err);
    return serverError(err);
  }
});
