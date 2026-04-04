// src/app/api/billing/webhook/route.ts
// POST /api/billing/webhook — Stripe Webhook ハンドラ
//
// Stripe が送信するイベントを受け取り、subscriptions テーブルを更新する。
//
// 対応イベント:
//   checkout.session.completed    — Checkout 完了 → Subscription を active に
//   customer.subscription.created — サブスクリプション作成（checkout.session.completed とほぼ同時）
//   customer.subscription.updated — 更新（期間更新・ステータス変更）
//   customer.subscription.deleted — キャンセル → status を canceled に
//
// セキュリティ:
//   - Stripe-Signature ヘッダーを STRIPE_WEBHOOK_SECRET で検証
//   - 検証失敗 → 400 を返す（Stripe は再試行しない）
//   - ハンドラ内の処理失敗 → 200 を返しつつログに記録（Stripe に再試行させない）
//
// 将来拡張:
//   - Customer Portal 用に customer.subscription.* を引き続き処理
//   - invoice.payment_failed などで past_due 対応を追加可能

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { prisma }    from "@/lib/prisma";

export const dynamic = "force-dynamic";

// ── Stripe ステータス → 内部ステータス変換 ───────────────────────────
function mapStripeStatus(stripeStatus: Stripe.Subscription["status"]): string {
  switch (stripeStatus) {
    case "active":             return "active";
    case "trialing":           return "trialing";
    case "past_due":           return "past_due";
    case "canceled":           return "canceled";
    case "incomplete_expired": return "canceled";
    case "unpaid":             return "past_due";
    default:                   return "active"; // incomplete / paused は active として扱う
  }
}

// ── checkout.session.completed 処理 ──────────────────────────────────
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const oaId    = session.metadata?.oaId;
  const toPlan  = session.metadata?.toPlan ?? "editor";
  const rawSub  = session.subscription;
  const stripeSubscriptionId =
    typeof rawSub === "string" ? rawSub : rawSub?.id ?? null;

  if (!oaId || !stripeSubscriptionId) {
    console.warn("[webhook] checkout.session.completed: oaId または subscription ID が不明", {
      oaId, stripeSubscriptionId,
    });
    return;
  }

  // Stripe サブスクリプション詳細を取得
  const stripe    = getStripe();
  const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);

  // editor プランを DB から取得
  const editorPlan = await prisma.plan.findUnique({ where: { name: toPlan } });
  if (!editorPlan) {
    console.error(`[webhook] plan '${toPlan}' が DB に存在しません。prisma/seed.mjs を確認してください。`);
    return;
  }

  const periodStart = new Date(stripeSub.current_period_start * 1000);
  const periodEnd   = new Date(stripeSub.current_period_end   * 1000);

  await prisma.subscription.upsert({
    where:  { oaId },
    update: {
      planId:             editorPlan.id,
      status:             "active",
      externalId:         stripeSubscriptionId,
      currentPeriodStart: periodStart,
      currentPeriodEnd:   periodEnd,
      canceledAt:         null,
    },
    create: {
      oaId,
      planId:             editorPlan.id,
      status:             "active",
      externalId:         stripeSubscriptionId,
      currentPeriodStart: periodStart,
      currentPeriodEnd:   periodEnd,
    },
  });

  console.log(`[webhook] checkout.session.completed: OA ${oaId} を ${toPlan} プランに更新しました`);
}

// ── customer.subscription.created / updated 処理 ─────────────────────
async function handleSubscriptionUpdated(stripeSub: Stripe.Subscription): Promise<void> {
  // externalId から既存 Subscription を検索
  const existing = await prisma.subscription.findFirst({
    where: { externalId: stripeSub.id },
  });

  if (!existing) {
    // externalId が未設定（checkout.session.completed より先に到達した場合）
    // metadata.oaId からフォールバック
    const oaId = stripeSub.metadata?.oaId;
    if (!oaId) {
      console.warn(`[webhook] subscription.updated: externalId ${stripeSub.id} に対応する Subscription が見つかりません`);
      return;
    }
    // oaId で検索して externalId を補完
    const byOaId = await prisma.subscription.findUnique({ where: { oaId } });
    if (!byOaId) return;

    await prisma.subscription.update({
      where: { id: byOaId.id },
      data: {
        externalId:         stripeSub.id,
        status:             mapStripeStatus(stripeSub.status),
        currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
        currentPeriodEnd:   new Date(stripeSub.current_period_end   * 1000),
      },
    });
    return;
  }

  await prisma.subscription.update({
    where: { id: existing.id },
    data: {
      status:             mapStripeStatus(stripeSub.status),
      currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
      currentPeriodEnd:   new Date(stripeSub.current_period_end   * 1000),
    },
  });

  console.log(`[webhook] subscription.updated: Subscription ${existing.id} ステータス → ${stripeSub.status}`);
}

// ── customer.subscription.deleted 処理 ───────────────────────────────
async function handleSubscriptionDeleted(stripeSub: Stripe.Subscription): Promise<void> {
  const existing = await prisma.subscription.findFirst({
    where: { externalId: stripeSub.id },
  });
  if (!existing) {
    console.warn(`[webhook] subscription.deleted: externalId ${stripeSub.id} に対応する Subscription が見つかりません`);
    return;
  }

  await prisma.subscription.update({
    where: { id: existing.id },
    data: {
      status:     "canceled",
      canceledAt: new Date(),
    },
  });

  console.log(`[webhook] subscription.deleted: Subscription ${existing.id} を canceled に更新しました`);
}

// ── メインハンドラ ───────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Stripe 署名検証 ─────────────────────────────────────────────
  const rawBody = await req.text();
  const sig     = req.headers.get("stripe-signature") ?? "";

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("[webhook] STRIPE_WEBHOOK_SECRET が設定されていません");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[webhook] 署名検証失敗:", msg);
    return NextResponse.json({ error: `Webhook signature verification failed: ${msg}` }, { status: 400 });
  }

  console.log(`[webhook] イベント受信: ${event.type} id=${event.id}`);

  // ── イベント処理 ────────────────────────────────────────────────
  // 処理失敗は 200 を返してログのみ記録（Stripe の再試行ループを防ぐ）
  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      default:
        // 未対応イベントはスキップ（200 を返す）
        console.log(`[webhook] 未対応イベント: ${event.type} — スキップ`);
    }
  } catch (err) {
    console.error(`[webhook] イベント処理中エラー (${event.type}):`, err);
    // 200 を返してから Stripe へ "受け取った" と伝える
    // 再試行が必要な場合は Stripe Dashboard から手動で行う
  }

  return NextResponse.json({ received: true });
}
