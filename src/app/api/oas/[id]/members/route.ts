// GET  /api/oas/:id/members — メンバー一覧 (owner のみ)
// POST /api/oas/:id/members — メンバー追加 (owner のみ)

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, conflict, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";
import { z, ZodError } from "zod";
import { isValidRole } from "@/lib/types/permissions";

const addMemberSchema = z.object({
  user_id: z.string().min(1, "user_id は必須です"),
  role:    z.string().refine(isValidRole, { message: "role は owner / editor / viewer のいずれかです" }),
});

// ── GET /api/oas/:id/members ─────────────────────
export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  'owner',
  async (_req, { params }) => {
    try {
      const oa = await prisma.oa.findUnique({ where: { id: params.id }, select: { id: true } });
      if (!oa) return notFound("OA");

      const members = await prisma.workspaceMember.findMany({
        where: { workspaceId: params.id },
        orderBy: { createdAt: "asc" },
      });

      return ok(
        members.map((m) => ({
          id:           m.id,
          workspace_id: m.workspaceId,
          user_id:      m.userId,
          role:         m.role,
          invited_by:   m.invitedBy,
          created_at:   m.createdAt,
          updated_at:   m.updatedAt,
        }))
      );
    } catch (err) {
      return serverError(err);
    }
  }
);

// ── POST /api/oas/:id/members ────────────────────
export const POST = withRole<{ id: string }>(
  ({ params }) => params.id,
  'owner',
  async (req, { params }, user) => {
    try {
      const oa = await prisma.oa.findUnique({ where: { id: params.id }, select: { id: true } });
      if (!oa) return notFound("OA");

      const body = await req.json();
      const data = addMemberSchema.parse(body);

      // 既存メンバーチェック
      const existing = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: params.id, userId: data.user_id } },
      });
      if (existing) {
        return conflict("このユーザーはすでにメンバーです");
      }

      const member = await prisma.workspaceMember.create({
        data: {
          workspaceId: params.id,
          userId:      data.user_id,
          role:        data.role,
          invitedBy:   user.id,
        },
      });

      return created({
        id:           member.id,
        workspace_id: member.workspaceId,
        user_id:      member.userId,
        role:         member.role,
        invited_by:   member.invitedBy,
        created_at:   member.createdAt,
        updated_at:   member.updatedAt,
      });
    } catch (err) {
      if (err instanceof ZodError) return badRequest("入力値が不正です", { role: ["role は owner / editor / viewer のいずれかです"] });
      return serverError(err);
    }
  }
);
