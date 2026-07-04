// src/app/api/oas/[id]/analytics-excluded-users/route.ts
// GET  /api/oas/:id/analytics-excluded-users — 分析除外ユーザー一覧（閲覧: viewer 以上）
// POST /api/oas/:id/analytics-excluded-users — 除外ユーザー追加（owner / admin のみ）
//
// 目的: 制作者/運営/テスターが実 LINE で動作確認したデータを、オーディエンス分析から除外する。
//   - OA 単位（@@unique([oaId, lineUserId])）。元データ（UserProgress 等）は削除しない。
//   - analytics 集計側で lineUserId を notIn 除外する（このAPIは登録管理のみ）。
//   - 追加/削除は owner/admin のみ。UI だけでなく API 側で必ず認可（withRole）。

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { withRole } from "@/lib/auth";
import { z, ZodError } from "zod";

/** UI 表示用に UID を一部マスク（末尾4桁のみ）。 */
function maskLineUserId(id: string): string {
  if (id.length <= 4) return "U***";
  return `U***${id.slice(-4)}`;
}

function toResponse(r: {
  id: string; oaId: string; lineUserId: string; memberUserId: string | null; displayName: string | null;
  note: string | null; createdByUserId: string | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    id:            r.id,
    oa_id:         r.oaId,
    line_user_id:  r.lineUserId,
    line_user_id_masked: maskLineUserId(r.lineUserId),
    member_user_id: r.memberUserId,
    display_name:  r.displayName,
    note:          r.note,
    created_by:    r.createdByUserId,
    created_at:    r.createdAt,
    updated_at:    r.updatedAt,
  };
}

const createSchema = z.object({
  line_user_id:   z.string().trim().min(1, "lineUserId は必須です").max(200),
  member_user_id: z.string().trim().max(200).optional(),
  display_name:   z.string().trim().max(200).optional(),
  note:           z.string().trim().max(500).optional(),
});

// ── GET（閲覧: viewer 以上＝tester 含む）──
export const GET = withRole<{ id: string }>(
  ({ params }) => params.id,
  ["viewer", "tester", "editor", "admin", "owner"],
  async (_req, { params }) => {
    try {
      const rows = await prisma.analyticsExcludedUser.findMany({
        where:   { oaId: params.id },
        orderBy: { createdAt: "desc" },
      });
      return ok({ items: rows.map(toResponse), total: rows.length });
    } catch (err) {
      return serverError(err);
    }
  },
);

// ── POST（追加: owner / admin のみ）──
export const POST = withRole<{ id: string }>(
  ({ params }) => params.id,
  ["admin", "owner"],
  async (req: NextRequest, { params }, user) => {
    try {
      const oa = await prisma.oa.findUnique({ where: { id: params.id }, select: { id: true } });
      if (!oa) return notFound("OA");

      const data = createSchema.parse(await req.json());

      // 重複追加は安全に扱う: 既存があれば displayName/note を更新する upsert（冪等）。
      const row = await prisma.analyticsExcludedUser.upsert({
        where:  { oaId_lineUserId: { oaId: params.id, lineUserId: data.line_user_id } },
        update: {
          ...(data.display_name !== undefined && { displayName: data.display_name || null }),
          ...(data.note !== undefined && { note: data.note || null }),
        },
        create: {
          oaId:            params.id,
          lineUserId:      data.line_user_id,
          memberUserId:    data.member_user_id || null,
          displayName:     data.display_name || null,
          note:            data.note || null,
          createdByUserId: user.id,
        },
      });
      return created(toResponse(row));
    } catch (err) {
      if (err instanceof ZodError) return badRequest("入力値が不正です");
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return badRequest("すでに除外登録済みです");
      }
      return serverError(err);
    }
  },
);
