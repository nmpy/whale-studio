// GET  /api/oas/:id/invitations  — 招待一覧 (admin / owner のみ)
// POST /api/oas/:id/invitations  — 招待作成 (admin / owner のみ)

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";
import { z, ZodError } from "zod";
import { isValidRole } from "@/lib/types/permissions";

const createInvitationSchema = z.object({
  email:      z.string().email("有効なメールアドレスを入力してください"),
  role:       z.string().refine(isValidRole, { message: "role は owner / admin / editor / viewer のいずれかです" }),
  expires_in: z.number().int().min(1).max(30).optional(), // 有効日数 (デフォルト: 7日)
});

// ── GET /api/oas/:id/invitations ─────────────────────
export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  ['admin', 'owner'],
  async (_req, { params }) => {
    try {
      const oa = await prisma.oa.findUnique({ where: { id: params.id }, select: { id: true } });
      if (!oa) return notFound("OA");

      const invitations = await prisma.invitation.findMany({
        where:   { oaId: params.id },
        orderBy: { createdAt: "desc" },
      });

      return ok(
        invitations.map((inv) => ({
          id:          inv.id,
          oa_id:       inv.oaId,
          email:       inv.email,
          role:        inv.role,
          token:       inv.token,
          invited_by:  inv.invitedBy,
          expires_at:  inv.expiresAt,
          accepted_at: inv.acceptedAt,
          created_at:  inv.createdAt,
          // 有効期限切れ・受け入れ済みフラグ
          is_expired:  inv.acceptedAt === null && inv.expiresAt < new Date(),
          is_accepted: inv.acceptedAt !== null,
        }))
      );
    } catch (err) {
      return serverError(err);
    }
  }
);

// ── POST /api/oas/:id/invitations ────────────────────
export const POST = withRole<{ id: string }>(
  ({ params }) => params.id,
  ['admin', 'owner'],
  async (req, { params }, user) => {
    try {
      const oa = await prisma.oa.findUnique({ where: { id: params.id }, select: { id: true } });
      if (!oa) return notFound("OA");

      const body = await req.json();
      const data = createInvitationSchema.parse(body);

      // 有効期限: デフォルト 7日
      const expiresInDays = data.expires_in ?? 7;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);

      // 同じメールで未処理の招待があれば上書き（token 再発行）
      const existing = await prisma.invitation.findFirst({
        where: {
          oaId:       params.id,
          email:      data.email,
          acceptedAt: null,
          expiresAt:  { gt: new Date() },
        },
      });

      let invitation;
      const token = crypto.randomUUID();

      if (existing) {
        // 既存の有効招待を更新（token + role + expiresAt を刷新）
        invitation = await prisma.invitation.update({
          where: { id: existing.id },
          data: {
            role:      data.role,
            token,
            invitedBy: user.id,
            expiresAt,
          },
        });
      } else {
        invitation = await prisma.invitation.create({
          data: {
            oaId:      params.id,
            email:     data.email,
            role:      data.role,
            token,
            invitedBy: user.id,
            expiresAt,
          },
        });
      }

      return created({
        id:          invitation.id,
        oa_id:       invitation.oaId,
        email:       invitation.email,
        role:        invitation.role,
        token:       invitation.token,
        invited_by:  invitation.invitedBy,
        expires_at:  invitation.expiresAt,
        accepted_at: invitation.acceptedAt,
        created_at:  invitation.createdAt,
        // フロントがリンクを生成できるよう accept URL を付与
        accept_url:  `/invite/${invitation.token}`,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        return badRequest("入力値が不正です", {
          email: err.issues.filter((i) => i.path[0] === "email").map((i) => i.message),
          role:  err.issues.filter((i) => i.path[0] === "role").map((i) => i.message),
        });
      }
      return serverError(err);
    }
  }
);
