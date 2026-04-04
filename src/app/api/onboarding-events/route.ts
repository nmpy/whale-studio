// src/app/api/onboarding-events/route.ts
// POST /api/onboarding-events — クライアント起点のオンボーディングステップ記録
//
// 用途: フロントエンド（プレビュー実行など）からステップ到達を記録する。
// サーバー起点のステップ（work_created 等）は API ルート内で直接 trackOnboardingStep を呼ぶ。

import { withAuth } from "@/lib/auth";
import { requireRole, getOaIdFromWorkId } from "@/lib/rbac";
import { badRequest, created, serverError } from "@/lib/api-response";
import { ONBOARDING_STEPS } from "@/lib/constants/onboarding";
import type { OnboardingStep } from "@/lib/constants/onboarding";
import { prisma } from "@/lib/prisma";
import { trackOnboardingProgress } from "@/lib/onboarding";
import { z } from "zod";

const schema = z.object({
  work_id: z.string().min(1),
  oa_id:   z.string().min(1),
  step:    z.enum(ONBOARDING_STEPS),
});

export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const body = await req.json();
    const data = schema.safeParse(body);
    if (!data.success) return badRequest("パラメータが不正です");

    const { work_id, oa_id, step } = data.data;

    // work が oa に属することを確認し、ロールチェック（tester 以上）
    const resolvedOaId = await getOaIdFromWorkId(work_id);
    const oaId = resolvedOaId ?? oa_id;

    const check = await requireRole(oaId, user.id, "tester");
    if (!check.ok) return check.response;

    // OnboardingEvent（作品単位）を記録
    await prisma.onboardingEvent.upsert({
      where:  { workId_step: { workId: work_id, step: step as OnboardingStep } },
      update: {},
      create: { workId: work_id, oaId, step },
    });

    // OnboardingProgress（ユーザー × 作品単位）を記録（fire-and-forget）
    trackOnboardingProgress({ userId: user.id, workId: work_id, step });

    return created({ ok: true });
  } catch (err) {
    return serverError(err);
  }
});
