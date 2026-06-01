// src/app/api/admin/policies/[id]/publish/route.ts
// POST /api/admin/policies/[id]/publish — 指定バージョンを公開 (platform admin only)
//
// - 同 type の既存公開版を isPublished=false に下げ、対象を isPublished=true にする
// - publishedAt を NOW() にセット (= 既存値がある場合は維持しても良いが、再公開は新時刻に更新)

import { prisma } from "@/lib/prisma";
import { ok, badRequest, forbidden, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";

export const dynamic = "force-dynamic";

export const POST = withAuth<{ id: string }>(async (_req, { params }, user) => {
  if (!isPlatformOwner(user.id)) return forbidden();

  try {
    const target = await prisma.policyDocumentVersion.findUnique({
      where: { id: params.id },
    });
    if (!target) return notFound("規約文書バージョン");

    if (target.isPublished) {
      return badRequest("このバージョンは既に公開中です");
    }

    const updated = await prisma.$transaction(async (tx) => {
      // 同 type の既存公開版を非公開に
      await tx.policyDocumentVersion.updateMany({
        where: { type: target.type, isPublished: true },
        data:  { isPublished: false },
      });
      // 対象を公開に
      return tx.policyDocumentVersion.update({
        where: { id: target.id },
        data:  { isPublished: true, publishedAt: new Date() },
      });
    });

    return ok({
      id:           updated.id,
      type:         updated.type,
      version:      updated.version,
      is_published: updated.isPublished,
      published_at: updated.publishedAt,
    });
  } catch (err) {
    return serverError(err);
  }
});
