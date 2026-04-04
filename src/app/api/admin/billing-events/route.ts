// src/app/api/admin/billing-events/route.ts
// GET /api/admin/billing-events — 課金導線イベント集計（プラットフォームオーナー専用）
//
// 集計元: billing_event_logs テーブル（source / oa_id / work_id 付き詳細ログ）
//
// レスポンス:
//   totals     : pricing_view / pricing_cta_click / pricing_feedback_submit の件数
//   by_source  : source（"header" / "banner" / "gate" / "preview" 等）ごとの件数
//                pricing_view の source 分布が主な用途
//   by_event   : 全イベントごとの件数
//
// 例:
//   {
//     "totals": {
//       "pricing_view": 120,
//       "pricing_cta_click": 18,
//       "pricing_feedback_submit": 7
//     },
//     "by_source": {
//       "header": 40,
//       "banner": 35,
//       "gate": 25,
//       "preview": 20
//     },
//     "by_event": {
//       "pricing_click_from_header": 40,
//       ...
//     }
//   }

import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { withPlatformAdmin } from "@/lib/with-platform-admin";

export const GET = withPlatformAdmin(async () => {
  try {
    // ── 2 つの groupBy を並列取得 ───────────────────────────────────
    const [byEventRows, bySourceRows] = await Promise.all([
      // event ごとの件数
      prisma.billingEventLog.groupBy({
        by:     ["event"],
        _count: { event: true },
      }),
      // source ごとの件数（null は集計対象外）
      prisma.billingEventLog.groupBy({
        by:     ["source"],
        _count: { source: true },
        where:  { source: { not: null } },
      }),
    ]);

    // ── by_event: 全イベント件数マップ ───────────────────────────────
    const by_event: Record<string, number> = {};
    for (const row of byEventRows) {
      by_event[row.event] = row._count.event;
    }

    // ── totals: 主要3イベントを取り出す ──────────────────────────────
    const totals = {
      pricing_view:             by_event["pricing_view"]             ?? 0,
      pricing_cta_click:        by_event["pricing_cta_click"]        ?? 0,
      pricing_feedback_submit:  by_event["pricing_feedback_submit"]  ?? 0,
    };

    // ── by_source: source 値ごとの件数マップ ─────────────────────────
    const by_source: Record<string, number> = {};
    for (const row of bySourceRows) {
      if (row.source != null) {
        by_source[row.source] = row._count.source;
      }
    }

    return ok({ totals, by_source, by_event });
  } catch (err) {
    return serverError(err);
  }
});
