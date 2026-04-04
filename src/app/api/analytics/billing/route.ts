// src/app/api/analytics/billing/route.ts
// GET /api/analytics/billing — 課金イベント集計（プラットフォームオーナー専用）
//
// レスポンス:
//   counts[]  : イベントごとの件数（BILLING_EVENTS 順を保持）
//   total     : 全イベント合計
//   funnel    : pricing_view → cta_click → feedback_submit の転換率

import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { withPlatformAdmin } from "@/lib/with-platform-admin";
import { BILLING_EVENTS, BILLING_EVENT_LABELS } from "@/lib/constants/billing-events";

export const GET = withPlatformAdmin(async (_req, _ctx, _user) => {
  try {
    const rows = await prisma.billingEvent.groupBy({
      by:     ["event"],
      _count: { event: true },
    });

    const countMap = new Map<string, number>(
      rows.map((r) => [r.event, r._count.event])
    );

    const counts = BILLING_EVENTS.map((event) => ({
      event,
      label: BILLING_EVENT_LABELS[event],
      count: countMap.get(event) ?? 0,
    }));

    const total = counts.reduce((s, c) => s + c.count, 0);

    // 転換ファネル
    const views     = countMap.get("pricing_view")           ?? 0;
    const ctaClicks = countMap.get("pricing_cta_click")      ?? 0;
    const submits   = countMap.get("pricing_feedback_submit") ?? 0;

    const funnel = {
      view_to_cta:    views > 0 ? Math.round((ctaClicks / views) * 100) : 0,
      cta_to_submit:  ctaClicks > 0 ? Math.round((submits / ctaClicks) * 100) : 0,
      view_to_submit: views > 0 ? Math.round((submits / views) * 100) : 0,
    };

    return ok({ counts, total, funnel });
  } catch (err) {
    return serverError(err);
  }
});
