// src/app/api/oas/[id]/plan-info/route.ts
// GET /api/oas/:id/plan-info — 作品数上限など表示用プラン情報取得（viewer 以上）
//
// GET /api/oas/:id/subscription（owner/admin 専用）と異なり、
// viewer 以上が呼び出せる軽量エンドポイント。
// 機密フィールド（externalId・canceledAt 等）は返さない。

import { withRole } from "@/lib/auth";
import { ok, serverError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { isPlatformOwner } from "@/lib/platform-admin";

export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  "viewer",
  async (_req, { params }, user) => {
    const oaId = params.id;

    // PLATFORM_ADMIN_USER_IDS に列挙された運営者は、UI 表示も最上位プラン (= pro) として返す。
    // plan-guard の bypass と表示を一致させるため。DB の Subscription は読まない。
    if (isPlatformOwner(user.id)) {
      return ok({
        plan_name:       "pro",
        display_name:    "Pro Max",
        max_works:       -1,   // 無制限
        max_players:     -1,   // 無制限
        price_monthly:   0,    // 表示用 (= platform admin は課金対象外)
        status:          "active",
      });
    }

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
