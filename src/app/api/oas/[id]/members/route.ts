// GET  /api/oas/:id/members — メンバー一覧 (admin / owner のみ)
// POST /api/oas/:id/members — メンバー直接追加 (owner のみ) ※招待フロー未使用時の管理用

import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, conflict, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";
import { z, ZodError } from "zod";
import { isValidRole } from "@/lib/types/permissions";

const addMemberSchema = z.object({
  user_id: z.string().min(1, "user_id は必須です"),
  role:    z.string().refine(isValidRole, { message: "role は owner / admin / editor / tester のいずれかです" }),
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

      const members = await prisma.workspaceMember.findMany({
        where:   { workspaceId: params.id },
        orderBy: { createdAt: "asc" },          // 参加日で一次ソート
      });

      // owner(0) → admin(1) → editor(2) → tester(3) の階層順で安定ソート
      // Prisma の enum orderBy はアルファベット順になるため、アプリ側で並び替える
      const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, editor: 2, tester: 3 };
      members.sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));

      return ok(members.map(formatMember));
    } catch (err) {
      return serverError(err);
    }
  }
);

// ── POST /api/oas/:id/members ────────────────────
// ユーザー ID が既知の場合の直接追加（owner のみ）。通常は招待フロー経由。
export const POST = withRole<{ id: string }>(
  ({ params }) => params.id,
  'owner',
  async (req, { params }, user) => {
    try {
      const oa = await prisma.oa.findUnique({ where: { id: params.id }, select: { id: true } });
      if (!oa) return notFound("OA");

      const body = await req.json();
      const data = addMemberSchema.parse(body);

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
