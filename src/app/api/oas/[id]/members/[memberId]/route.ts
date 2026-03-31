// PATCH  /api/oas/:id/members/:memberId — ロール変更 (owner のみ)
// DELETE /api/oas/:id/members/:memberId — メンバー削除 (owner のみ)

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";
import { z, ZodError } from "zod";
import { isValidRole } from "@/lib/types/permissions";

const updateRoleSchema = z.object({
  role: z.string().refine(isValidRole, { message: "role は owner / editor / viewer のいずれかです" }),
});

// ── PATCH /api/oas/:id/members/:memberId ─────────
export const PATCH = withRole<{ id: string; memberId: string }>(
  ({ params }) => params.id,
  'owner',
  async (req, { params }, user) => {
    try {
      const member = await prisma.workspaceMember.findFirst({
        where: { id: params.memberId, workspaceId: params.id },
      });
      if (!member) return notFound("メンバー");

      const body = await req.json();
      const data = updateRoleSchema.parse(body);

      // 自分自身の owner 権限を剥奪しようとした場合は拒否
      if (member.userId === user.id && data.role !== 'owner') {
        // owner が1人だけかチェック
        const ownerCount = await prisma.workspaceMember.count({
          where: { workspaceId: params.id, role: 'owner' },
        });
        if (ownerCount <= 1) {
          return badRequest("最後の owner の権限は変更できません", {
            role: ["ワークスペースに owner が1人以上必要です"],
          });
        }
      }

      const updated = await prisma.workspaceMember.update({
        where: { id: params.memberId },
        data: { role: data.role },
      });

      return ok({
        id:           updated.id,
        workspace_id: updated.workspaceId,
        user_id:      updated.userId,
        role:         updated.role,
        invited_by:   updated.invitedBy,
        created_at:   updated.createdAt,
        updated_at:   updated.updatedAt,
      });
    } catch (err) {
      if (err instanceof ZodError) return badRequest("入力値が不正です", { role: ["role は owner / editor / viewer のいずれかです"] });
      return serverError(err);
    }
  }
);

// ── DELETE /api/oas/:id/members/:memberId ────────
export const DELETE = withRole<{ id: string; memberId: string }>(
  ({ params }) => params.id,
  'owner',
  async (_req, { params }, user) => {
    try {
      const member = await prisma.workspaceMember.findFirst({
        where: { id: params.memberId, workspaceId: params.id },
      });
      if (!member) return notFound("メンバー");

      // 最後の owner は削除不可
      if (member.role === 'owner') {
        const ownerCount = await prisma.workspaceMember.count({
          where: { workspaceId: params.id, role: 'owner' },
        });
        if (ownerCount <= 1) {
          return badRequest("最後の owner は削除できません", {
            member: ["ワークスペースに owner が1人以上必要です"],
          });
        }
      }

      await prisma.workspaceMember.delete({ where: { id: params.memberId } });
      return noContent();
    } catch (err) {
      return serverError(err);
    }
  }
);
