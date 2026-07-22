// src/app/api/admin/uzu-pro-grants/route.ts
// GET    /api/admin/uzu-pro-grants — for ウズプロ権限（UzuProGrant）一覧（platform owner 専用）
// POST   /api/admin/uzu-pro-grants — 権限付与（upsert）
// DELETE /api/admin/uzu-pro-grants?userId=... — 権限解除（冪等）
//
// 認可は platform owner のみ（isPlatformOwner）。workspace owner も通す withPlatformAdmin は使わない。
// userId は Supabase の user id（氏名/メール等の PII ではない）。自由記述欄（note 等）は持たない = PII 保存不可。
// 付与/解除は運営操作のため AdminAuditLog に必要最小限（actorId/action/resource/resourceId=userId/日時）だけ記録する。

import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, forbidden, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";
import { z, ZodError } from "zod";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, _ctx, user) => {
  if (!isPlatformOwner(user.id)) return forbidden();
  try {
    const grants = await prisma.uzuProGrant.findMany({
      select:  { userId: true, grantedBy: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return ok({ grants });
  } catch (err) {
    return serverError(err);
  }
});

// strict(): userId 以外の未知キー（note 等の自由記述・PII を含みうる）は 400 で拒否する。
const postSchema = z
  .object({
    userId: z.string().min(1, "userId は必須です"),
  })
  .strict();

export const POST = withAuth(async (req, _ctx, user) => {
  if (!isPlatformOwner(user.id)) return forbidden();
  try {
    const body = await req.json().catch(() => ({}));
    const { userId } = postSchema.parse(body);

    await prisma.uzuProGrant.upsert({
      where:  { userId },
      create: { userId, grantedBy: user.id },
      update: { grantedBy: user.id },
    });

    await prisma.adminAuditLog.create({
      data: { actorId: user.id, action: "create", resource: "uzu_pro_grant", resourceId: userId },
    });

    return created({ userId });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力が不正です");
    return serverError(err);
  }
});

export const DELETE = withAuth(async (req, _ctx, user) => {
  if (!isPlatformOwner(user.id)) return forbidden();
  try {
    const url = new URL(req.url);
    let userId = url.searchParams.get("userId") ?? undefined;
    if (!userId) {
      const body = await req.json().catch(() => ({}));
      if (body && typeof body.userId === "string") userId = body.userId;
    }
    if (!userId) return badRequest("userId は必須です");

    const { count } = await prisma.uzuProGrant.deleteMany({ where: { userId } });

    await prisma.adminAuditLog.create({
      data: { actorId: user.id, action: "delete", resource: "uzu_pro_grant", resourceId: userId },
    });

    return ok({ userId, revoked: count > 0 });
  } catch (err) {
    return serverError(err);
  }
});
