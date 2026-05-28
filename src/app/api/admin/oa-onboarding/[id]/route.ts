// src/app/api/admin/oa-onboarding/[id]/route.ts
// PATCH /api/admin/oa-onboarding/[id] — 審査ステータスを変更する（運営専用）。
//
// status:
//   - IN_REVIEW: 確認中マーカー（任意で SUBMITTED → IN_REVIEW へ）
//   - APPROVED:  承認。onboarding-approve.ts 経由で Oa + WorkspaceMember(owner) を作成する
//   - REJECTED:  差し戻し。review_note を必須にする（運用上の親切設計）

import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { withPlatformAdmin } from "@/lib/with-platform-admin";
import { adminUpdateOnboardingSchema } from "@/lib/validations/onboarding";
import { formatZodErrors } from "@/lib/validations";
import { approveOnboardingRequest } from "@/lib/onboarding-approve";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

export const PATCH = withPlatformAdmin<{ id: string }>(async (req, { params }, user) => {
  try {
    const body = await req.json().catch(() => ({}));
    const data = adminUpdateOnboardingSchema.parse(body);

    const target = await prisma.oaOnboardingRequest.findUnique({ where: { id: params.id } });
    if (!target) return notFound("オンボーディング申請");

    if (data.status === "APPROVED") {
      if (target.status === "APPROVED") {
        return badRequest("既に承認済みです");
      }
      const result = await approveOnboardingRequest({
        request: target,
        reviewerUserId: user.id,
      });
      return ok({ id: target.id, status: "APPROVED" as const, oa_id: result.oaId });
    }

    if (data.status === "REJECTED") {
      if (!data.review_note || data.review_note.trim().length === 0) {
        return badRequest("差し戻し理由 (review_note) を入力してください");
      }
      const updated = await prisma.oaOnboardingRequest.update({
        where: { id: params.id },
        data: {
          status:     "REJECTED",
          reviewedAt: new Date(),
          reviewedBy: user.id,
          reviewNote: data.review_note,
        },
      });
      return ok({ id: updated.id, status: updated.status, review_note: updated.reviewNote });
    }

    // IN_REVIEW: SUBMITTED の row を IN_REVIEW に進めるだけ
    if (target.status !== "SUBMITTED" && target.status !== "IN_REVIEW") {
      return badRequest("IN_REVIEW に変更できるのは SUBMITTED / IN_REVIEW の申請のみです");
    }
    const updated = await prisma.oaOnboardingRequest.update({
      where: { id: params.id },
      data: { status: "IN_REVIEW", reviewedBy: user.id },
    });
    return ok({ id: updated.id, status: updated.status });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
