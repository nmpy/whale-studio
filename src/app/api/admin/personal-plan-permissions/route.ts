// src/app/api/admin/personal-plan-permissions/route.ts
// GET /api/admin/personal-plan-permissions — 個人利用 OA の一覧（platform admin 専用）
//
// 表示対象: Oa.usageType = personal のみ（法人利用 OA は除外 = 法人プラン権限側で扱う）。
// 権限: platform admin 以外は 404 で存在秘匿。未ログインは withAuth が 401。
//
// プラン / トライアル状態は既存の Subscription → Plan から解決する（新規カラムなし）。
// owner の username は Profile、email は WorkspaceMember.email（Supabase 同期・null あり）から
// best-effort で取得する。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";
import { PLAN_LABELS } from "@/lib/constants/plans";
import { effectiveTierFromSub, grantDisplayKind, formatTrialEndDate } from "@/lib/subscription-grant";

/** 通常サブスクの status → トライアル状態表示（β版/trial は grantDisplayKind 側で扱う）。 */
function normalStatusLabel(status: string | null): string {
  switch (status) {
    case "trialing": return "トライアル中";
    case "active":   return "通常";
    case "canceled":
    case "past_due": return "期限切れ";
    default:         return "不明"; // サブスクなし等
  }
}

export const GET = withAuth(async (_req: NextRequest, _ctx, user) => {
  try {
    if (!isPlatformOwner(user.id)) return notFound("ページ");

    // 個人利用 OA のみ（subscription + plan を同梱）
    const oas = await prisma.oa.findMany({
      where:   { usageType: "personal" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, title: true, usageType: true, ownerKey: true,
        createdAt: true, updatedAt: true,
        subscription: {
          select: {
            status: true, externalId: true, grantType: true, trialEndsAt: true,
            currentPeriodStart: true, currentPeriodEnd: true,
            plan: { select: { name: true, displayName: true, maxWorks: true, maxPlayers: true } },
          },
        },
      },
    });

    // owner 情報を batch 取得（username = Profile / email = owner の WorkspaceMember.email）
    const ownerIds = Array.from(new Set(oas.map((o) => o.ownerKey).filter((k): k is string => !!k)));
    const oaIds    = oas.map((o) => o.id);

    const [profiles, ownerMembers] = await Promise.all([
      ownerIds.length
        ? prisma.profile.findMany({ where: { userId: { in: ownerIds } }, select: { userId: true, username: true } })
        : Promise.resolve([]),
      oaIds.length
        ? prisma.workspaceMember.findMany({
            where:  { workspaceId: { in: oaIds }, role: "owner" },
            select: { workspaceId: true, userId: true, email: true },
          })
        : Promise.resolve([]),
    ]);
    const usernameByUserId = new Map(profiles.map((p) => [p.userId, p.username] as const));
    // workspace 単位の owner member（owner_key と一致するものを優先）
    const ownerEmailByOaId = new Map<string, string | null>();
    for (const oa of oas) {
      const members = ownerMembers.filter((m) => m.workspaceId === oa.id);
      const match = members.find((m) => m.userId === oa.ownerKey) ?? members[0] ?? null;
      ownerEmailByOaId.set(oa.id, match?.email ?? null);
    }

    const data = oas.map((oa) => {
      const sub  = oa.subscription;
      const subLike = sub
        ? { status: sub.status, grantType: sub.grantType, trialEndsAt: sub.trialEndsAt, planName: sub.plan?.name ?? null }
        : null;
      // 実効ティア（β版=pro / トライアル内=pro / 失効=basic / 通常=plan tier）。
      const effTier = effectiveTierFromSub(subLike);
      const kind    = grantDisplayKind(subLike); // "beta" | "trial_active" | "trial_expired" | "normal"

      // 表示用の現在プラン・状態ラベル。
      const planLabel =
        kind === "beta"          ? `β版（${PLAN_LABELS.pro}相当）`
        : sub                    ? PLAN_LABELS[effTier]
        :                          null; // サブスクなし
      const statusLabel =
        kind === "beta"          ? "β版"
        : kind === "trial_active"  ? "トライアル中"
        : kind === "trial_expired" ? "トライアル終了"
        :                            normalStatusLabel(sub?.status ?? null);

      return {
        id:                oa.id,
        title:             oa.title,
        usage_type:        oa.usageType,
        plan_name:         sub?.plan?.name ?? null,
        plan_tier:         sub ? effTier : null,
        plan_label:        planLabel,
        grant_kind:        kind,
        status:            sub?.status ?? null,
        status_label:      statusLabel,
        trial_end_label:   formatTrialEndDate(sub?.trialEndsAt ?? null),
        is_beta:           kind === "beta",
        max_works:         sub?.plan?.maxWorks ?? null,
        max_players:       sub?.plan?.maxPlayers ?? null,
        // Stripe 連動（externalId 有）なら手動変更不可。
        external_billing:  !!sub?.externalId,
        owner_user_id:     oa.ownerKey ?? null,
        owner_username:    oa.ownerKey ? (usernameByUserId.get(oa.ownerKey) ?? null) : null,
        owner_email:       ownerEmailByOaId.get(oa.id) ?? null,
        created_at:        oa.createdAt.toISOString(),
        updated_at:        oa.updatedAt.toISOString(),
      };
    });

    return ok(data);
  } catch (err) {
    return serverError(err);
  }
});
