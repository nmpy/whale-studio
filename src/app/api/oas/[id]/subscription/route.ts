// src/app/api/oas/[id]/subscription/route.ts
// GET /api/oas/:id/subscription — 現在のプラン・サブスクリプション情報を返す
//
// 権限: owner / admin
// レスポンス:
//   subscription が存在する場合: { plan, subscription }
//   存在しない場合: { plan: null, subscription: null }（role fallback を使用中）

import { withRole }          from "@/lib/auth";
import { ok, serverError }   from "@/lib/api-response";
import { prisma }            from "@/lib/prisma";
import { grantDisplayKind, formatTrialEndDate } from "@/lib/subscription-grant";

export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  ["owner", "admin"] as const,
  async (_req, { params }) => {
    try {
      const sub = await prisma.subscription.findUnique({
        where:   { oaId: params.id },
        include: { plan: true },
      });

      if (!sub) {
        return ok({ plan: null, subscription: null });
      }

      return ok({
        plan: {
          name:          sub.plan.name,
          display_name:  sub.plan.displayName,
          max_works:     sub.plan.maxWorks,
          max_players:   sub.plan.maxPlayers,
          price_monthly: sub.plan.priceMonthly,
        },
        subscription: {
          id:                   sub.id,
          status:               sub.status,
          current_period_start: sub.currentPeriodStart,
          current_period_end:   sub.currentPeriodEnd,
          canceled_at:          sub.canceledAt,
          external_id:          sub.externalId,
          // β版 / トライアル表示用（追加のみ・既存フィールド不変）。
          grant_type:           sub.grantType ?? null,
          grant_kind:           grantDisplayKind({ status: sub.status, grantType: sub.grantType, trialEndsAt: sub.trialEndsAt }),
          trial_ends_at:        sub.trialEndsAt?.toISOString() ?? null,
          trial_end_label:      formatTrialEndDate(sub.trialEndsAt),
        },
      });
    } catch (err) {
      return serverError(err);
    }
  }
);
