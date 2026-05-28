// src/app/api/onboarding/status/route.ts
// GET /api/onboarding/status — 現在のユーザーのオンボード状態を返す。
//
// レスポンス:
//   {
//     terms_accepted:    boolean,
//     terms_version:     string,
//     owns_any_oa:       boolean,   // = 既存ユーザー or 承認済み
//     onboarding_status: "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "APPROVED" | "REJECTED" | null,
//     onboarding_id:     string | null,
//   }

import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { withAuth } from "@/lib/auth";
import { CURRENT_TERMS_VERSION } from "@/lib/constants/terms";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, _ctx, user) => {
  try {
    const [terms, ownsAnyOa, latest] = await Promise.all([
      prisma.termsAcceptance.findUnique({
        where: { userId_termsVersion: { userId: user.id, termsVersion: CURRENT_TERMS_VERSION } },
        select: { acceptedAt: true },
      }),
      prisma.workspaceMember.findFirst({
        where: { userId: user.id, role: "owner", status: "active" },
        select: { workspaceId: true },
      }),
      prisma.oaOnboardingRequest.findFirst({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
        select: { id: true, status: true },
      }),
    ]);

    return ok({
      terms_accepted:    !!terms,
      terms_version:     CURRENT_TERMS_VERSION,
      owns_any_oa:       !!ownsAnyOa,
      onboarding_status: latest?.status ?? null,
      onboarding_id:     latest?.id ?? null,
    });
  } catch (err) {
    return serverError(err);
  }
});
