// PATCH  /api/oas/:id/members/:memberId — ロール / ステータス変更 (admin / owner)
// DELETE /api/oas/:id/members/:memberId — メンバー削除 (owner のみ)
//
// 権限ルール:
//   - admin は owner メンバーの role / status を変更不可
//   - admin は role を owner に昇格させることも不可
//   - 最後の owner の role 変更 / 削除は禁止

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";
import { z, ZodError } from "zod";
import { isValidRole } from "@/lib/types/permissions";

const VALID_STATUSES = ["active", "inactive", "suspended"] as const;
type MemberStatus = typeof VALID_STATUSES[number];

const updateMemberSchema = z.object({
  role:   z.string().refine(isValidRole, { message: "role は owner / admin / editor / tester のいずれかです" }).optional(),
  status: z.enum(VALID_STATUSES, { message: "status は active / inactive / suspended のいずれかです" }).optional(),
}).refine((d) => d.role !== undefined || d.status !== undefined, {
  message: "role か status のどちらかは必須です",
});

// ── PATCH /api/oas/:id/members/:memberId ─────────
export const PATCH = withRole<{ id: string; memberId: string }>(
  ({ params }) => params.id,
  ['admin', 'owner'],
  async (req, { params }, user, requesterRole) => {
    try {
      const target = await prisma.workspaceMember.findFirst({
        where: { id: params.memberId, workspaceId: params.id },
      });
      if (!target) return notFound("メンバー");

      // ── admin → owner 操作禁止 ──
      if (requesterRole === 'admin' && target.role === 'owner') {
        return NextResponse.json(
          { success: false, error: { code: 'FORBIDDEN', message: 'admin は owner の権限・ステータスを変更できません' } },
          { status: 403 }
        );
      }

      const body = await req.json();
      const data = updateMemberSchema.parse(body);

      // ── admin が owner に昇格させようとした場合も禁止 ──
      if (requesterRole === 'admin' && data.role === 'owner') {
        return NextResponse.json(
          { success: false, error: { code: 'FORBIDDEN', message: 'admin は owner ロールを付与できません' } },
          { status: 403 }
        );
      }

      // ── 最後の owner の role 変更禁止 ──
      if (data.role && data.role !== 'owner' && target.role === 'owner') {
        const ownerCount = await prisma.workspaceMember.count({
          where: { workspaceId: params.id, role: 'owner' },
        });
        if (ownerCount <= 1) {
          return badRequest("最後の owner のロールは変更できません", {
            role: ["ワークスペースに owner が1人以上必要です"],
          });
        }
      }

      // ── 自分自身を owner から降格させる禁止 ──
      if (target.userId === user.id && data.role && data.role !== 'owner' && target.role === 'owner') {
        const ownerCount = await prisma.workspaceMember.count({
          where: { workspaceId: params.id, role: 'owner' },
        });
        if (ownerCount <= 1) {
          return badRequest("最後の owner の権限は変更できません", {
            role: ["先に他のメンバーを owner に昇格させてください"],
          });
        }
      }

      const updated = await prisma.workspaceMember.update({
        where: { id: params.memberId },
        data: {
          ...(data.role   ? { role:   data.role }   : {}),
          ...(data.status ? { status: data.status } : {}),
        },
      });

      return ok({
        id:           updated.id,
        workspace_id: updated.workspaceId,
        user_id:      updated.userId,
        email:        updated.email,
        role:         updated.role,
        status:       updated.status,
        invited_by:   updated.invitedBy,
        invited_at:   updated.invitedAt,
        joined_at:    updated.joinedAt,
        created_at:   updated.createdAt,
        updated_at:   updated.updatedAt,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        return badRequest("入力値が不正です", {
          role:   err.issues.filter((i) => i.path[0] === "role").map((i) => i.message),
          status: err.issues.filter((i) => i.path[0] === "status").map((i) => i.message),
        });
      }
      return serverError(err);
    }
  }
);

// ── DELETE /api/oas/:id/members/:memberId ────────
export const DELETE = withRole<{ id: string; memberId: string }>(
  ({ params }) => params.id,
  'owner',
  async (_req, { params }) => {
    try {
      const target = await prisma.workspaceMember.findFirst({
        where: { id: params.memberId, workspaceId: params.id },
      });
      if (!target) return notFound("メンバー");

      // 最後の owner は削除不可
      if (target.role === 'owner') {
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
