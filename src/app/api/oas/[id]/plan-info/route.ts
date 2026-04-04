// src/app/api/oas/[id]/plan-info/route.ts
// GET /api/oas/:id/plan-info — 作品数上限など表示用プラン情報取得（viewer 以上）
//
// GET /api/oas/:id/subscription（owner/admin 専用）と異なり、
// viewer 以上が呼び出せる軽量エンドポイント。
// 機密フィールド（externalId・canceledAt 等）は返さない。

import { withRole } from "@/lib/auth";
import { ok, serverError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  "viewer",
  async (_req, { params }) => {
    const oaId = params.id;
    try {
      const sub = await prisma.subscription.findUnique({
        where:   { oaId },
        include: {
          plan: {
            select: {
              name:         true,
              displayName:  true,
              maxWorks:     true,
              maxPlayers:   true,
              priceMonthly: true,
            },
          },
        },
      });

      if (!sub || !sub.plan) {
        // Subscription 未設定（シード未実行 or 旧 OA）→ null を返す
        return ok(null);
      }

      return ok({
        plan_name:       sub.plan.name,
        display_name:    sub.plan.displayName,
        max_works:       sub.plan.maxWorks,   // -1 = 無制限
        max_players:     sub.plan.maxPlayers, // -1 = 無制限
        price_monthly:   sub.plan.priceMonthly,
        status:          sub.status,
      });
    } catch (err) {
      return serverError(err);
    }
  }
);
