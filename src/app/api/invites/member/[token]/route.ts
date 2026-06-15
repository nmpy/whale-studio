// GET /api/invites/member/:token — 招待URLの検証 (公開・認証不要)
//
// 平文 token を hash 化して招待を検索し、OA 名・付与ロール・状態を返す。
// 内部情報は出さない（status と OA 表示名・ロールのみ）。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { hashMemberInviteToken, memberInviteStatus } from "@/lib/member-invite";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const invite = await prisma.memberInvite.findUnique({
      where:   { tokenHash: hashMemberInviteToken(token) },
      include: { oa: { select: { id: true, title: true, serviceSuspendedAt: true } } },
    });

    // 存在しない token も 200 で valid:false を返す（フロントで一様な「無効」表示。内部情報は出さない）。
    if (!invite) {
      return ok({ valid: false, status: "invalid" });
    }

    const status = memberInviteStatus(invite); // pending / accepted / expired / revoked
    const suspended = !!invite.oa.serviceSuspendedAt;
    return ok({
      valid:      status === "pending" && !suspended,
      status:     suspended ? "suspended" : status,
      oa_id:      invite.oa.id,
      oa_name:    invite.oa.title,
      role:       invite.role,
    });
  } catch (err) {
    return serverError(err);
  }
}
