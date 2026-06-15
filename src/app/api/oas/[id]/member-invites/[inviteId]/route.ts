// DELETE /api/oas/:id/member-invites/:inviteId — 招待URLの無効化 (admin / owner のみ)
//
// 無効化は soft（revokedAt を立てる）。受諾済みは無効化不可。冪等（既に無効化済みでも成功）。

import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";

export const DELETE = withRole<{ id: string; inviteId: string }>(
  ({ params }) => params.id,
  ["admin", "owner"],
  async (_req, { params }) => {
    try {
      const invite = await prisma.memberInvite.findUnique({ where: { id: params.inviteId } });
      if (!invite || invite.oaId !== params.id) return notFound("招待URL");
      if (invite.acceptedAt) return badRequest("受諾済みの招待URLは無効化できません");
      if (invite.revokedAt) return ok({ id: invite.id, revoked_at: invite.revokedAt }); // 冪等
      const updated = await prisma.memberInvite.update({
        where: { id: invite.id },
        data:  { revokedAt: new Date() },
      });
      return ok({ id: updated.id, revoked_at: updated.revokedAt });
    } catch (err) {
      return serverError(err);
    }
  },
);
