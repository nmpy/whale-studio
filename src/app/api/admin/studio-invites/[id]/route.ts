// PATCH /api/admin/studio-invites/:id — 招待URLの無効化 / 再有効化
//
// action="revoke": revokedAt を now にセット（無効化 = disabledAt 相当）。
// action="enable": revokedAt を null に戻す（再有効化）。期限切れ/使用済みは expiresAt/usedCount で別途判定。
//
// 権限: 対象 OA の owner|admin（platform owner は getWorkspaceRole 側で owner 扱い）。発行 API と同方針。
// 操作ログ（AdminAuditLog）に revoke / enable を記録する。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { requireRole } from "@/lib/rbac";
import { ZodError, z } from "zod";

export const dynamic = "force-dynamic";

const patchSchema = z.object({ action: z.enum(["revoke", "enable"]) });

export const PATCH = withAuth<{ id: string }>(async (req: NextRequest, { params }, user) => {
  try {
    const { action } = patchSchema.parse(await req.json().catch(() => ({})));

    const invite = await prisma.studioInvite.findUnique({
      where:  { id: params.id },
      select: { id: true, oaId: true, revokedAt: true },
    });
    if (!invite) return notFound("招待URL");

    // 発行と同じく対象 OA の owner|admin（platform owner は owner 扱い）を要求。
    const check = await requireRole(invite.oaId, user.id, ["owner", "admin"]);
    if (!check.ok) return check.response;

    if (action === "revoke") {
      if (invite.revokedAt) return ok({ id: invite.id, revoked: true, already: true });
      await prisma.studioInvite.update({ where: { id: invite.id }, data: { revokedAt: new Date() } });
    } else {
      if (!invite.revokedAt) return ok({ id: invite.id, revoked: false, already: true });
      await prisma.studioInvite.update({ where: { id: invite.id }, data: { revokedAt: null } });
    }

    // 操作ログ（無効化 / 再有効化）。失敗してもメイン処理は止めない。
    await prisma.adminAuditLog.create({
      data: {
        actorId:    user.id,
        action:     action === "revoke" ? "revoke" : "enable",
        resource:   "studio_invite",
        resourceId: invite.id,
        detail:     JSON.stringify({ oa_id: invite.oaId }),
      },
    }).catch(() => {});

    return ok({ id: invite.id, revoked: action === "revoke", already: false });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力内容に誤りがあります");
    return serverError(err);
  }
});
