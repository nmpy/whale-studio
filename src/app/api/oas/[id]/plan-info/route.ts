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
import { grantDisplayKind, formatTrialEndDate } from "@/lib/subscription-grant";

/** ?previewPlan で受け取り可能な値 (= UI tier の小文字キー)。
 *  これ以外は無視 (= 通常レスポンスを返す)。 */
const VALID_PREVIEW_PLANS = new Set(["basic", "standard", "plus", "pro"]);

export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  "viewer",
  async (req, { params }, user, role) => {
    const oaId = params.id;

    // 表示確認モード (= access preview) からの呼び出し。
    // owner / platform admin だけが honor され、それ以外は無視。
    // 役割: UI 側の preview-aware display surface (= useEffectivePlanInfo 経由) に対し、
    // 「このティアだったらどう表示されるか」をサーバーから返す。実権限 / 課金 / Subscription DB は不変。
    const url = new URL(req.url);
    const previewPlanRaw = url.searchParams.get("previewPlan");
    const canHonorPreview = isPlatformOwner(user.id) || role === "owner";
    const previewPlan = (canHonorPreview && previewPlanRaw && VALID_PREVIEW_PLANS.has(previewPlanRaw))
      ? previewPlanRaw
      : null;

    if (previewPlan) {
      try {
        // Plan テーブルから tier 名と完全一致する row を取得 (= seed 上 name は tier 値と同じ前提)。
        const plan = await prisma.plan.findUnique({
          where: { name: previewPlan },
          select: { name: true, displayName: true, maxWorks: true, maxPlayers: true, priceMonthly: true },
        });
        if (plan) {
          return ok({
            plan_name:       plan.name,
            display_name:    plan.displayName,
            max_works:       plan.maxWorks,
            max_players:     plan.maxPlayers,
            price_monthly:   plan.priceMonthly,
            status:          "active",
            _preview:        true,  // 表示確認モード由来であることを示すマーカー
          });
        }
        // Plan が見つからない場合は通常パスにフォールバック (= 黙って real 値を返す)。
      } catch (err) {
        // DB エラー時もフォールバック (= 通常レスポンスを返す)。
        console.warn("[plan-info] previewPlan lookup failed:", err);
      }
    }

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

      // β版 / トライアルの表示区分（"beta" / "trial_active" / "trial_expired" / "normal"）。
      const grantKind = grantDisplayKind({
        status: sub.status, grantType: sub.grantType, trialEndsAt: sub.trialEndsAt,
      });

      return ok({
        plan_name:       sub.plan.name,
        display_name:    sub.plan.displayName,
        max_works:       sub.plan.maxWorks,   // -1 = 無制限
        max_players:     sub.plan.maxPlayers, // -1 = 無制限
        price_monthly:   sub.plan.priceMonthly,
        status:          sub.status,
        // β版 / トライアル表示用（既存フィールドは互換維持し追加のみ）。
        grant_type:      sub.grantType ?? null,
        grant_kind:      grantKind,
        trial_ends_at:   sub.trialEndsAt?.toISOString() ?? null,
        trial_end_label: formatTrialEndDate(sub.trialEndsAt),
      });
    } catch (err) {
      return serverError(err);
    }
  }
);
