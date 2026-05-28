// src/app/api/onboarding/oa/route.ts
// GET   /api/onboarding/oa — 自分の最新の OnboardingRequest を返す（なければ DRAFT を作って返す）
// PATCH /api/onboarding/oa — Step 2 の OA 連携情報を保存（DRAFT / REJECTED のみ更新可）

import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { updateOnboardingOaSchema } from "@/lib/validations/onboarding";
import { formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";
import type { OaOnboardingRequest } from "@prisma/client";

export const dynamic = "force-dynamic";

function toResponse(req: OaOnboardingRequest) {
  return {
    id:              req.id,
    status:          req.status,
    oa_name:         req.oaName,
    channel_id:      req.channelId,
    // Secret / Token はマスクして返す（クライアント側のフォーム再表示用に存在有無のみ伝える）
    channel_secret_set: !!req.channelSecret,
    channel_token_set:  !!req.channelToken,
    basic_id:        req.basicId,
    liff_id:         req.liffId,
    permission_url:  req.permissionUrl,
    submitted_at:    req.submittedAt,
    reviewed_at:     req.reviewedAt,
    review_note:     req.reviewNote,
    oa_id:           req.oaId,
    created_at:      req.createdAt,
    updated_at:      req.updatedAt,
  };
}

export const GET = withAuth(async (_req, _ctx, user) => {
  try {
    let latest = await prisma.oaOnboardingRequest.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
    });

    if (!latest) {
      latest = await prisma.oaOnboardingRequest.create({
        data: { userId: user.id, status: "DRAFT" },
      });
    }

    return ok(toResponse(latest));
  } catch (err) {
    return serverError(err);
  }
});

export const PATCH = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json().catch(() => ({}));
    const data = updateOnboardingOaSchema.parse(body);

    const latest = await prisma.oaOnboardingRequest.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
    });

    if (!latest) {
      return badRequest("オンボーディング申請が存在しません。先に GET /api/onboarding/oa を呼んでください。");
    }

    // DRAFT / REJECTED 以外（= SUBMITTED / IN_REVIEW / APPROVED）は編集禁止
    if (latest.status !== "DRAFT" && latest.status !== "REJECTED") {
      return badRequest("提出済みの申請は編集できません。差し戻しを待つか、運営にお問い合わせください。");
    }

    const updated = await prisma.oaOnboardingRequest.update({
      where: { id: latest.id },
      data: {
        ...(data.oa_name        !== undefined && { oaName:        data.oa_name }),
        ...(data.channel_id     !== undefined && { channelId:     data.channel_id }),
        ...(data.channel_secret !== undefined && { channelSecret: data.channel_secret }),
        ...(data.channel_token  !== undefined && { channelToken:  data.channel_token }),
        ...(data.basic_id       !== undefined && { basicId:       data.basic_id }),
        ...(data.liff_id        !== undefined && { liffId:        data.liff_id }),
        // 差し戻し中の編集は DRAFT に戻す（= 再提出可能な状態にする）
        ...(latest.status === "REJECTED" && { status: "DRAFT" as const }),
      },
    });

    return ok(toResponse(updated));
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
