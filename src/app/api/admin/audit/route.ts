// src/app/api/admin/audit/route.ts
// GET /api/admin/audit — 操作ログ一覧（最新100件）

import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { withPlatformAdmin } from "@/lib/with-platform-admin";
import { resolveAuditActorName } from "@/lib/audit-display";

export const GET = withPlatformAdmin(async () => {
  try {
    const logs = await prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // 操作者（actorId = Supabase Auth userId）を Profile に join して表示名を解決する。
    // 取得する個人情報は表示に必要な username / 姓名のみに限定。
    const actorIds = [...new Set(logs.map((l) => l.actorId))];
    const profiles = actorIds.length
      ? await prisma.profile.findMany({
          where:  { userId: { in: actorIds } },
          select: { userId: true, username: true, firstName: true, lastName: true },
        })
      : [];
    const profileByUserId = new Map(profiles.map((p) => [p.userId, p]));

    return ok(
      logs.map((l) => ({
        id:          l.id,
        actor_id:    l.actorId,
        // 追加フィールド: 操作者の表示名（UUID は出さない・未紐づけは「不明」）。既存フィールドは維持。
        user_name:   resolveAuditActorName(profileByUserId.get(l.actorId)),
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
