// src/app/api/admin/business-invite-links/[id]/revoke/route.ts
// POST /api/admin/business-invite-links/[id]/revoke — リンクを無効化 (platform admin 専用)
//
// 既に申込済み (usedAt) のリンクも revoke 可能 (= 以降の状態表示を revoked に寄せるだけ)。
// platform admin 以外は 404 で存在秘匿。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";
import { businessInviteState } from "@/lib/business-invite";

export const POST = withAuth<{ id: string }>(async (_req: NextRequest, ctx, user) => {
  try {
    if (!isPlatformOwner(user.id)) return notFound("ページ");

    const existing = await prisma.businessInviteLink.findUnique({
      where: { id: ctx.params.id },
    });
    if (!existing) return notFound("招待リンク");

    // 冪等: 既に revoke 済みならそのまま返す
    const link = existing.revokedAt
      ? existing
      : await prisma.businessInviteLink.update({
          where: { id: ctx.params.id },
          data:  { revokedAt: new Date() },
        });

    return ok({
      id:         link.id,
      state:      businessInviteState(link),
      revoked_at: link.revokedAt?.toISOString() ?? null,
    });
  } catch (err) {
    return serverError(err);
  }
});
