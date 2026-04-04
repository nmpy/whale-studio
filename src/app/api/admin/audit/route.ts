// src/app/api/admin/audit/route.ts
// GET /api/admin/audit — 操作ログ一覧（最新100件）

import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { withPlatformAdmin } from "@/lib/with-platform-admin";

export const GET = withPlatformAdmin(async () => {
  try {
    const logs = await prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return ok(
      logs.map((l) => ({
        id:          l.id,
        actor_id:    l.actorId,
        action:      l.action,
        resource:    l.resource,
        resource_id: l.resourceId,
        detail:      l.detail,
        created_at:  l.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    return serverError(err);
  }
});
