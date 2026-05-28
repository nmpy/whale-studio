// src/app/api/admin/oa-onboarding/route.ts
// GET /api/admin/oa-onboarding — 全 OnboardingRequest を一覧で返す（運営専用）。
//
// secret / token は機微情報のため返さない（存在有無のみ）。
// reviewer 側では「Channel ID / OA名 / 権限URL」を見て承認判断する想定。

import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { withPlatformAdmin } from "@/lib/with-platform-admin";

export const dynamic = "force-dynamic";

export const GET = withPlatformAdmin(async () => {
  try {
    const rows = await prisma.oaOnboardingRequest.findMany({
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });

    // メール / username を取るために Profile を join 風に取得
    const userIds = Array.from(new Set(rows.map((r) => r.userId)));
    const profiles = await prisma.profile.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, username: true },
    });
    const profileMap = new Map(profiles.map((p) => [p.userId, p.username]));

    return ok(
      rows.map((r) => ({
        id:                 r.id,
        user_id:            r.userId,
        username:           profileMap.get(r.userId) ?? null,
        status:             r.status,
        oa_id:              r.oaId,
        oa_name:            r.oaName,
        channel_id:         r.channelId,
        // secret / token は返さない
        channel_secret_set: !!r.channelSecret,
        channel_token_set:  !!r.channelToken,
        basic_id:           r.basicId,
        liff_id:            r.liffId,
        permission_url:     r.permissionUrl,
        submitted_at:       r.submittedAt,
        reviewed_at:        r.reviewedAt,
        reviewed_by:        r.reviewedBy,
        review_note:        r.reviewNote,
        created_at:         r.createdAt,
        updated_at:         r.updatedAt,
      })),
    );
  } catch (err) {
    return serverError(err);
  }
});
