// GET  /api/admin/studio-invites — 発行済み招待URL一覧 + 発行可能な対象 OA 一覧
// POST /api/admin/studio-invites — 招待URL発行 (対象 OA の owner|admin / platform owner のみ)
//
// スタジオ管理から発行する「招待URL」(StudioInvite)。MemberInvite / BusinessInviteLink とは別系統。
// 平文 token は発行直後にのみ返し、DB には tokenHash のみ保存する。
// planTier は課金非連動の付与 snapshot (Stripe には連動しない)。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { isPlatformOwner } from "@/lib/platform-admin";
import { ROLE_LABELS, type Role } from "@/lib/types/permissions";
import { PLAN_LABELS, type PlanTier } from "@/lib/constants/plans";
import { usageTypeShortLabel } from "@/lib/usage-type";
import { ZodError } from "zod";
import {
  generateStudioInviteToken, hashStudioInviteToken,
  resolveStudioInviteExpiresAt, studioInviteState, buildStudioInviteUrl,
  issueStudioInviteSchema,
} from "@/lib/studio-invite";

export const dynamic = "force-dynamic";

/** リクエストユーザーが「招待URLを発行・閲覧できる」OA の id 一覧を返す。
 *  - platform owner: 全 OA
 *  - それ以外: ownerKey 一致 OR active な owner|admin の WorkspaceMember を持つ OA */
async function manageableOaIds(userId: string): Promise<{ ids: string[]; isPlatform: boolean }> {
  if (isPlatformOwner(userId)) {
    const all = await prisma.oa.findMany({ select: { id: true }, take: 1000 });
    return { ids: all.map((o) => o.id), isPlatform: true };
  }
  const [owned, memberOf] = await Promise.all([
    prisma.oa.findMany({ where: { ownerKey: userId }, select: { id: true } }),
    prisma.workspaceMember.findMany({
      where:  { userId, status: "active", role: { in: ["owner", "admin"] } },
      select: { workspaceId: true },
    }),
  ]);
  const ids = new Set<string>();
  owned.forEach((o) => ids.add(o.id));
  memberOf.forEach((m) => ids.add(m.workspaceId));
  return { ids: [...ids], isPlatform: false };
}

function planLabel(tier: string): string {
  return PLAN_LABELS[tier as PlanTier] ?? tier;
}

// ── GET /api/admin/studio-invites ──
export const GET = withAuth(async (_req: NextRequest, _ctx, user) => {
  try {
    const { ids } = await manageableOaIds(user.id);
    if (ids.length === 0) {
      return ok({ oas: [], invites: [] });
    }
    const [oas, invites] = await Promise.all([
      prisma.oa.findMany({
        where:   { id: { in: ids } },
        select:  { id: true, title: true, usageType: true },
        orderBy: { createdAt: "desc" },
        take:    1000,
      }),
      prisma.studioInvite.findMany({
        where:   { oaId: { in: ids } },
        orderBy: { createdAt: "desc" },
        take:    300,
      }),
    ]);
    const now = new Date();
    const oaName = new Map(oas.map((o) => [o.id, o.title]));
    return ok({
      oas: oas.map((o) => ({ id: o.id, title: o.title, usage_type: o.usageType })),
      invites: invites.map((inv) => ({
        id:               inv.id,
        oa_id:            inv.oaId,
        oa_name:          oaName.get(inv.oaId) ?? inv.oaId,
        usage_type:       inv.usageType,
        usage_type_label: usageTypeShortLabel(inv.usageType),
        plan_tier:        inv.planTier,
        plan_label:       planLabel(inv.planTier),
        role:             inv.role,
        role_label:       ROLE_LABELS[inv.role as Role] ?? inv.role,
        note:             inv.note,
        state:            studioInviteState(inv, now),
        created_at:       inv.createdAt,
        expires_at:       inv.expiresAt,
        accepted_at:      inv.acceptedAt,
        revoked_at:       inv.revokedAt,
        // token / tokenHash は返さない（発行直後のみ表示）。
      })),
    });
  } catch (err) {
    return serverError(err);
  }
});

// ── POST /api/admin/studio-invites ──
export const POST = withAuth(async (req: NextRequest, _ctx, user) => {
  try {
    if (process.env.NODE_ENV === "production" && user.id === "bypass-admin") {
      return badRequest("bypass-admin ユーザーでは本番環境の招待URLを発行できません");
    }
    const data = issueStudioInviteSchema.parse(await req.json().catch(() => ({})));

    // 発行者が対象 OA の owner|admin か必ず確認（platform owner は getWorkspaceRole 側で owner 扱い）。
    const check = await requireRole(data.oa_id, user.id, ["owner", "admin"]);
    if (!check.ok) return check.response;

    const oa = await prisma.oa.findUnique({
      where:  { id: data.oa_id },
      select: { id: true, title: true, serviceSuspendedAt: true },
    });
    if (!oa) return notFound("OA");
    if (oa.serviceSuspendedAt) return badRequest("このアカウントは現在停止中のため招待URLを発行できません");

    const now = new Date();
    const token = generateStudioInviteToken();
    const expiresAt = resolveStudioInviteExpiresAt(now);

    const invite = await prisma.studioInvite.create({
      data: {
        oaId:            data.oa_id,
        usageType:       data.usage_type,
        planTier:        data.plan_tier,
        role:            data.role,
        tokenHash:       hashStudioInviteToken(token),
        note:            data.note?.trim() ? data.note.trim() : null,
        createdByUserId: user.id,
        expiresAt,
      },
    });

    // 平文 token は発行直後のレスポンスでのみ返す（再表示不可）。
    return created({
      id:               invite.id,
      invite_url:       buildStudioInviteUrl(token),
      oa_id:            invite.oaId,
      oa_name:          oa.title,
      usage_type:       invite.usageType,
      usage_type_label: usageTypeShortLabel(invite.usageType),
      plan_tier:        invite.planTier,
      plan_label:       planLabel(invite.planTier),
      role:             invite.role,
      role_label:       ROLE_LABELS[invite.role as Role] ?? invite.role,
      expires_at:       invite.expiresAt,
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力内容に誤りがあります");
    return serverError(err);
  }
});
