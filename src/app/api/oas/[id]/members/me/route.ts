// GET /api/oas/:id/members/me — 自分のロールを取得（viewer以上）

export const dynamic = "force-dynamic";

import { withRole } from "@/lib/auth";
import { ok, notFound, serverError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  'viewer',
  async (_req, { params }, user, role) => {
    try {
      const oa = await prisma.oa.findUnique({
        where: { id: params.id },
        select: { id: true, title: true },
      });
      if (!oa) return notFound("OA");

      return ok({
        workspace_id: params.id,
        user_id:      user.id,
        role,
      });
    } catch (err) {
      return serverError(err);
    }
  }
);
