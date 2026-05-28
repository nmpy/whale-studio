// PATCH  /api/oas/:id/members/:memberId — ロール / ステータス変更 (admin / owner)
// DELETE /api/oas/:id/members/:memberId — メンバー削除 (admin / owner)
//
// 権限ルール:
//   - admin は owner メンバーの role / status / 削除を操作不可
//   - admin は role を owner に昇格させることも不可
//   - 最後の owner の role 変更 / 削除は禁止
//   - 削除後、対象ユーザーが再度アプリを操作すれば provisional に再表示される

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, noContent, badRequest, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";
import { ensureActiveOwnerRemains, LastOwnerError } from "@/lib/rbac";
import { z, ZodError } from "zod";
import { isValidRole } from "@/lib/types/permissions";
import { isLiveEnabled } from "@/lib/live";

const VALID_STATUSES = ["active", "inactive", "suspended"] as const;
type MemberStatus = typeof VALID_STATUSES[number];

const updateMemberSchema = z.object({
  role:      z.string().refine(isValidRole, { message: "role は owner / admin / editor / viewer のいずれかです" }).optional(),
  status:    z.enum(VALID_STATUSES, { message: "status は active / inactive / suspended のいずれかです" }).optional(),
  // Whale Studio Live のロール（null = 剥奪 / Live 有効 OA のみ付与可）。
  live_role: z.enum(["live_player", "live_admin", "live_actor"]).nullable().optional(),
}).refine((d) => d.role !== undefined || d.status !== undefined || d.live_role !== undefined, {
  message: "role / status / live_role のいずれかは必須です",
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

      // ── Live 無効 OA に live_role 付与が来たら 400（null=剥奪は許可）──
      if (data.live_role != null && !(await isLiveEnabled(params.id))) {
        return badRequest("この OA では Whale Studio Live が有効化されていないため、Live 権限は付与できません");
      }

      // ── owner 保護: role 降格 or status 非active化 ──
      const needsOwnerGuard =
        (data.role && data.role !== 'owner' && target.role === 'owner') ||
        (data.status && data.status !== 'active' && target.role === 'owner' && target.status === 'active');

      const updated = await prisma.$transaction(async (tx) => {
        if (needsOwnerGuard) {
          await ensureActiveOwnerRemains(params.id, params.memberId, tx);
        }
        return tx.workspaceMember.update({
          where: { id: params.memberId },
          data: {
            ...(data.role   ? { role:   data.role }   : {}),
            ...(data.status ? { status: data.status } : {}),
            // live_role は undefined=変更なし / null=剥奪 / 値=付与
            ...(data.live_role !== undefined ? { liveRole: data.live_role } : {}),
          },
        });
      });

      return ok({
        id:           updated.id,
        workspace_id: updated.workspaceId,
        user_id:      updated.userId,
        email:        updated.email,
        role:         updated.role,
        live_role:    updated.liveRole ?? null,
        status:       updated.status,
        invited_by:   updated.invitedBy,
        invited_at:   updated.invitedAt,
        joined_at:    updated.joinedAt,
        created_at:   updated.createdAt,
        updated_at:   updated.updatedAt,
      });
    } catch (err) {
      if (err instanceof LastOwnerError) {
        return badRequest(err.message, {
          owner: ["先に他のメンバーをオーナーに昇格させてください"],
        });
      }
      if (err instanceof ZodError) {
        return badRequest("入力値が不正です", {
          role:      err.issues.filter((i) => i.path[0] === "role").map((i) => i.message),
          status:    err.issues.filter((i) => i.path[0] === "status").map((i) => i.message),
          live_role: err.issues.filter((i) => i.path[0] === "live_role").map((i) => i.message),
        });
      }
      return serverError(err);
    }
  }
);

// ── DELETE /api/oas/:id/members/:memberId ────────
// admin / owner 両方が削除可能。ただし:
//   - admin は owner メンバーを削除不可
//   - 最後の owner は誰も削除不可
// 削除後、対象ユーザーが再度アプリを操作すれば provisional に再表示される。
export const DELETE = withRole<{ id: string; memberId: string }>(
  ({ params }) => params.id,
  ['admin', 'owner'],
  async (_req, { params }, _user, requesterRole) => {
    try {
      const target = await prisma.workspaceMember.findFirst({
        where: { id: params.memberId, workspaceId: params.id },
      });
      if (!target) return notFound("メンバー");

      // admin は owner メンバーを削除不可
      if (requesterRole === 'admin' && target.role === 'owner') {
        return NextResponse.json(
          { success: false, error: { code: 'FORBIDDEN', message: 'admin は owner メンバーを削除できません' } },
          { status: 403 }
        );
      }

      // owner 保護 + 削除をトランザクションで実行
      await prisma.$transaction(async (tx) => {
        if (target.role === 'owner') {
          await ensureActiveOwnerRemains(params.id, params.memberId, tx);
        }
        await tx.workspaceMember.delete({ where: { id: params.memberId } });
      });
      return noContent();
    } catch (err) {
      if (err instanceof LastOwnerError) {
        return badRequest(err.message, {
          owner: ["先に他のメンバーをオーナーに昇格させてください"],
        });
      }
      return serverError(err);
    }
  }
);
