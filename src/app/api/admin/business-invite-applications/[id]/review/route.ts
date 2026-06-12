// src/app/api/admin/business-invite-applications/[id]/review/route.ts
// POST /api/admin/business-invite-applications/[id]/review — 法人申込の承認 / 却下 (platform admin 専用)
//
// 重要: 承認 / 却下は **運営管理用のステータス変更のみ**。
//   自動 OA 作成 / 自動メンバー招待 / 自動権限付与 / 自動課金は一切行わない。
//   承認後の OA 作成・権限付与・請求対応は運営が手動で行う。
//
// 権限: platform admin 以外は 404 で存在秘匿。未ログインは withAuth が 401。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/platform-admin";
import {
  reviewBusinessApplicationSchema,
  BUSINESS_APP_STATUS_LABELS,
} from "@/lib/business-invite";
import { ZodError } from "zod";

export const POST = withAuth<{ id: string }>(async (req: NextRequest, ctx, user) => {
  try {
    if (!isPlatformOwner(user.id)) return notFound("ページ");

    const existing = await prisma.businessInviteApplication.findUnique({
      where: { id: ctx.params.id },
    });
    if (!existing) return notFound("申込");

    const body = await req.json();
    const data = reviewBusinessApplicationSchema.parse(body);

    // ステータス変更のみ（OA 作成 / 権限付与 / 課金は行わない）。
    const updated = await prisma.businessInviteApplication.update({
      where: { id: ctx.params.id },
      data: {
        status:           data.status,
        reviewedAt:       new Date(),
        reviewedByUserId: user.id,
        reviewNote:       data.reviewNote ?? null,
      },
      select: { id: true, status: true, reviewedAt: true, reviewNote: true },
    });

    return ok({
      id:           updated.id,
      status:       updated.status,
      status_label: BUSINESS_APP_STATUS_LABELS[updated.status as keyof typeof BUSINESS_APP_STATUS_LABELS] ?? updated.status,
      reviewed_at:  updated.reviewedAt?.toISOString() ?? null,
      review_note:  updated.reviewNote,
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です");
    return serverError(err);
  }
});
