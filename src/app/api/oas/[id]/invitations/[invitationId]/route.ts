// DELETE /api/oas/:id/invitations/:invitationId — 招待取り消し (admin / owner のみ)

import { prisma } from "@/lib/prisma";
import { noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";

// ── DELETE /api/oas/:id/invitations/:invitationId ─────
export const DELETE = withRole<{ id: string; invitationId: string }>(
  ({ params }) => params.id,
  ['admin', 'owner'],
  async (_req, { params }) => {
    try {
      const invitation = await prisma.invitation.findFirst({
        where: { id: params.invitationId, oaId: params.id },
      });
      if (!invitation) return notFound("招待");

      // 受け入れ済みの招待は取り消し不可
      if (invitation.acceptedAt !== null) {
        return badRequest("受け入れ済みの招待は取り消しできません", {
          invitation: ["この招待はすでに承諾されています"],
        });
      }

      await prisma.invitation.delete({ where: { id: params.invitationId } });
      return noContent();
    } catch (err) {
      return serverError(err);
    }
  }
);
