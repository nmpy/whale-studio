// GET  /api/oas/:id/member-invites — 招待URL一覧 (admin / owner のみ)
// POST /api/oas/:id/member-invites — 招待URL発行 (admin / owner のみ・email 不要)
//
// メールアドレス不要の招待URL。平文 token は発行直後にのみ返し、DB には tokenHash のみ保存する。

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";
import { z, ZodError } from "zod";
import {
  generateMemberInviteToken, hashMemberInviteToken,
  resolveMemberInviteExpiresAt, memberInviteStatus, buildMemberInviteUrl,
  MEMBER_INVITE_DEFAULT_EXPIRES_IN_DAYS, MEMBER_INVITE_ACTIVE_LIMIT,
} from "@/lib/member-invite";

// owner は URL 招待で付与できない（オーナー権限を URL で配るのは危険）。
const createMemberInviteSchema = z.object({
  role:       z.enum(["admin", "editor", "tester", "viewer"]).default("viewer"),
  expires_in: z.number().int().min(1).max(30).optional(), // 有効日数（既定 7 日）
});

// ── GET /api/oas/:id/member-invites ──
export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  ["admin", "owner"],
  async (_req, { params }) => {
    try {
      const oa = await prisma.oa.findUnique({ where: { id: params.id }, select: { id: true } });
      if (!oa) return notFound("OA");
      const now = new Date();
      const invites = await prisma.memberInvite.findMany({
        where:   { oaId: params.id },
        orderBy: { createdAt: "desc" },
      });
      // token / tokenHash は返さない（発行時のみ表示）。
      return ok(invites.map((inv) => ({
        id:                  inv.id,
        oa_id:               inv.oaId,
        role:                inv.role,
        status:              memberInviteStatus(inv, now),
        created_by_user_id:  inv.createdByUserId,
        accepted_by_user_id: inv.acceptedByUserId,
        accepted_at:         inv.acceptedAt,
        revoked_at:          inv.revokedAt,
        expires_at:          inv.expiresAt,
        created_at:          inv.createdAt,
      })));
    } catch (err) {
      return serverError(err);
    }
  },
);

// ── POST /api/oas/:id/member-invites ──
export const POST = withRole<{ id: string }>(
  ({ params }) => params.id,
  ["admin", "owner"],
  async (req: NextRequest, { params }, user) => {
    try {
      const oa = await prisma.oa.findUnique({ where: { id: params.id }, select: { id: true, serviceSuspendedAt: true } });
      if (!oa) return notFound("OA");
      if (oa.serviceSuspendedAt) return badRequest("このアカウントは現在停止中のため招待URLを発行できません");

      const data = createMemberInviteSchema.parse(await req.json().catch(() => ({})));

      // mass 発行防止: 有効(pending)な招待URLが上限に達していたら拒否。
      const now = new Date();
      const activeCount = await prisma.memberInvite.count({
        where: { oaId: params.id, acceptedAt: null, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      });
      if (activeCount >= MEMBER_INVITE_ACTIVE_LIMIT) {
        return badRequest(`有効な招待URLが上限(${MEMBER_INVITE_ACTIVE_LIMIT}件)に達しています。不要な招待URLを無効化してください。`);
      }

      const token = generateMemberInviteToken();
      const expiresAt = resolveMemberInviteExpiresAt(now, data.expires_in ?? MEMBER_INVITE_DEFAULT_EXPIRES_IN_DAYS);
      const invite = await prisma.memberInvite.create({
        data: {
          oaId:            params.id,
          role:            data.role,
          tokenHash:       hashMemberInviteToken(token),
          createdByUserId: user.id,
          expiresAt,
        },
      });

      // 平文 token は発行直後のレスポンスでのみ返す（再表示不可）。
      return created({
        id:         invite.id,
        invite_url: buildMemberInviteUrl(token),
        role:       invite.role,
        expires_at: invite.expiresAt,
      });
    } catch (err) {
      if (err instanceof ZodError) return badRequest("入力内容に誤りがあります");
      return serverError(err);
    }
  },
);
