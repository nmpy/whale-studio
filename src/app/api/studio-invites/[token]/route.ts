// GET /api/studio-invites/:token — 招待URLの検証 (公開・認証不要)
//
// 平文 token を hash 化して招待を検索し、対象 OA 名・利用区分・プラン・ロール・有効期限・状態を返す。
// 受諾(消費)はしない（usedAt を更新しない）。active 以外では内部情報を出さず state のみ返す。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { ROLE_LABELS, type Role } from "@/lib/types/permissions";
import { PLAN_LABELS, type PlanTier } from "@/lib/constants/plans";
import { usageTypeShortLabel } from "@/lib/usage-type";
import { hashStudioInviteToken, studioInviteState } from "@/lib/studio-invite";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const invite = await prisma.studioInvite.findUnique({
      where:   { tokenHash: hashStudioInviteToken(token) },
      include: { oa: { select: { id: true, title: true, serviceSuspendedAt: true } } },
    });

    const state = studioInviteState(invite);
    // active 以外は内部情報を出さない（一様な「無効/期限切れ/使用済み」表示）。
    if (state !== "active") {
      return ok({ state, valid: false });
    }
    // OA 停止中は受諾不可（state は active でも valid:false の suspended 扱い）。
    if (invite!.oa.serviceSuspendedAt) {
      return ok({ state: "suspended", valid: false });
    }
    return ok({
      state,
      valid:            true,
      oa_id:            invite!.oa.id,
      oa_name:          invite!.oa.title,
      usage_type:       invite!.usageType,
      usage_type_label: usageTypeShortLabel(invite!.usageType),
      plan_tier:        invite!.planTier,
      plan_label:       PLAN_LABELS[invite!.planTier as PlanTier] ?? invite!.planTier,
      role:             invite!.role,
      role_label:       ROLE_LABELS[invite!.role as Role] ?? invite!.role,
      expires_at:       invite!.expiresAt,
    });
  } catch (err) {
    return serverError(err);
  }
}
