// GET /api/oas/:id/members/me — 自分のロールを取得（viewer以上）

export const dynamic = "force-dynamic";

import { withRole } from "@/lib/auth";
import { ok, notFound, serverError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { isLiveEnabled, getLiveRole, canAccessLive } from "@/lib/live";

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

      // Whale Studio Live: ナビ表示の出し分けに使う。
      // Live 無効 OA / 権限なしユーザーには live を露出しない（live_enabled=false, live_role=null）。
      const live_enabled = await isLiveEnabled(params.id);
      const live_role    = live_enabled ? await getLiveRole(params.id, user.id) : null;
      const live_access  = live_enabled ? await canAccessLive(params.id, user.id) : false;

      return ok({
        workspace_id: params.id,
        user_id:      user.id,
        role,
        live_enabled,
        live_role,
        live_access,
      });
    } catch (err) {
      return serverError(err);
    }
  }
);
