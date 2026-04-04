// GET  /api/oas/:id/members — メンバー一覧 + 未登録の最近操作ユーザー（admin / owner のみ）
// POST /api/oas/:id/members — メンバー追加・仮ユーザー正式登録（admin / owner）

import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, conflict, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";
import { z, ZodError } from "zod";
import { isValidRole } from "@/lib/types/permissions";

const addMemberSchema = z.object({
  user_id: z.string().min(1, "user_id は必須です"),
  role:    z.string().refine(isValidRole, { message: "role は owner / admin / editor / viewer のいずれかです" }),
  email:   z.string().email().optional(),
});

function formatMember(m: {
  id: string;
  workspaceId: string;
  userId: string;
  email: string | null;
  role: string;
  status: string;
  invitedBy: string | null;
  invitedAt: Date | null;
  joinedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    type:         "member" as const,
    id:           m.id,
    workspace_id: m.workspaceId,
    user_id:      m.userId,
    email:        m.email,
    role:         m.role,
    status:       m.status,
    invited_by:   m.invitedBy,
    invited_at:   m.invitedAt,
    joined_at:    m.joinedAt,
    created_at:   m.createdAt,
    updated_at:   m.updatedAt,
  };
}

// ── GET /api/oas/:id/members ─────────────────────
export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  ['admin', 'owner'],
  async (_req, { params }) => {
    try {
      const oa = await prisma.oa.findUnique({ where: { id: params.id }, select: { id: true } });
      if (!oa) return notFound("OA");

      // ── 既存 WorkspaceMember ──────────────────────────────────
      const members = await prisma.workspaceMember.findMany({
        where:   { workspaceId: params.id },
        orderBy: { createdAt: "asc" },
      });

      // owner(0) → admin(1) → editor(2) → viewer(3) の階層順で安定ソート
      const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, editor: 2, viewer: 3, tester: 3 };
      members.sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));

      const memberUserIds = new Set(members.map((m) => m.userId));

      // ── 最近操作したが未登録のユーザー（過去30日、最大50件）──
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const recentActivity = await prisma.appActivityLog.findMany({
        where: {
          lastSeenAt: { gte: thirtyDaysAgo },
          userId:     { notIn: Array.from(memberUserIds) },
        },
        orderBy: { lastSeenAt: "desc" },
        take:    50,
      });

      // ── レスポンス ────────────────────────────────────────────
      return ok({
        members:     members.map(formatMember),
        provisional: recentActivity.map((a) => ({
          type:          "provisional" as const,
          user_id:       a.userId,
          email:         a.email,
          last_seen_at:  a.lastSeenAt.toISOString(),
        })),
      });
    } catch (err) {
      return serverError(err);
    }
  }
);

// ── POST /api/oas/:id/members ────────────────────
// メンバー直接追加 / 仮ユーザーの正式登録（admin / owner）
// admin は owner ロールを付与不可。
export const POST = withRole<{ id: string }>(
  ({ params }) => params.id,
  ['admin', 'owner'],
  async (req, { params }, user, requesterRole) => {
    try {
      const oa = await prisma.oa.findUnique({ where: { id: params.id }, select: { id: true } });
      if (!oa) return notFound("OA");

      const body = await req.json();
      const data = addMemberSchema.parse(body);

      // admin は owner ロールを付与不可
      if (requesterRole === 'admin' && data.role === 'owner') {
        return badRequest("admin は owner ロールを付与できません", {
          role: ["owner ロールの付与は owner のみ可能です"],
        });
      }

      const existing = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: params.id, userId: data.user_id } },
      });
      if (existing) return conflict("このユーザーはすでにメンバーです");

      const member = await prisma.workspaceMember.create({
        data: {
          workspaceId: params.id,
          userId:      data.user_id,
          email:       data.email ?? null,
          role:        data.role,
          status:      "active",
          invitedBy:   user.id,
          joinedAt:    new Date(),
        },
      });

      return created(formatMember(member));
    } catch (err) {
      if (err instanceof ZodError) {
        return badRequest("入力値が不正です", {
          user_id: err.issues.filter((i) => i.path[0] === "user_id").map((i) => i.message),
          role:    err.issues.filter((i) => i.path[0] === "role").map((i) => i.message),
        });
      }
      return serverError(err);
    }
  }
);
