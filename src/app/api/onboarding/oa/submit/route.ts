// src/app/api/onboarding/oa/submit/route.ts
// POST /api/onboarding/oa/submit — 権限URLを提出して審査に回す。
//
// 条件:
//   - 現在の申請が DRAFT または REJECTED であること
//   - oa_name / channel_id / channel_secret / channel_token が入力済みであること
//   - permission_url は https:// 始まりの有効な URL であること

import { prisma } from "@/lib/prisma";
import { ok, badRequest, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { submitOnboardingOaSchema } from "@/lib/validations/onboarding";
import { formatZodErrors } from "@/lib/validations";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json().catch(() => ({}));
    const data = submitOnboardingOaSchema.parse(body);

    const latest = await prisma.oaOnboardingRequest.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
    });

    if (!latest) {
      return badRequest("オンボーディング申請が存在しません。先に Step 2 を保存してください。");
    }

    if (latest.status !== "DRAFT" && latest.status !== "REJECTED") {
      return badRequest("既に提出済みです。");
    }

    // Step 2 の必須項目チェック
    const missing: string[] = [];
    if (!latest.oaName)        missing.push("LINE公式アカウント名");
    if (!latest.channelId)     missing.push("Channel ID");
    if (!latest.channelSecret) missing.push("Channel Secret");
    if (!latest.channelToken)  missing.push("Channel Access Token");
    if (missing.length > 0) {
      return badRequest(`Step 2 の入力が未完了です: ${missing.join(" / ")}`);
    }

    const updated = await prisma.oaOnboardingRequest.update({
      where: { id: latest.id },
      data: {
        status:        "SUBMITTED",
        permissionUrl: data.permission_url,
        submittedAt:   new Date(),
        // 差し戻しからの再提出時は review 情報をクリアする
        reviewedAt:    null,
        reviewedBy:    null,
        reviewNote:    null,
      },
    });

    return ok({
      id:             updated.id,
      status:         updated.status,
      permission_url: updated.permissionUrl,
      submitted_at:   updated.submittedAt,
    });
  } catch (err) {
    if (err instanceof ZodError) return badRequest("入力値が不正です", formatZodErrors(err));
    return serverError(err);
  }
});
