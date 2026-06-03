// src/app/api/oas/[id]/live/sessions/route.ts
// GET  /api/oas/:id/live/sessions — Live セッション一覧
// POST /api/oas/:id/live/sessions — Live セッション作成
//
// 認可:
//   GET  : platform admin / OA owner / live_owner / live_admin
//   POST : 同上 (= read/write 同集合)
// Live 無効 OA / 権限なしは 404 で存在を露出しない。
//
// Phase 2-G: workId / work_title を返却 / 作成時に workId を受付。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const createSessionSchema = z.object({
  name:      z.string().min(1, "name は必須です").max(120, "name は 120 文字以内"),
  status:    z.enum(["draft", "active", "ended"]).optional(),
  starts_at: z.string().datetime().optional().nullable(),
  ends_at:   z.string().datetime().optional().nullable(),
  work_id:   z.string().uuid().optional().nullable(),
});

type SessionWithWork = {
  id: string;
  oaId: string;
  workId: string | null;
  name: string;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  work: { id: string; title: string } | null;
};

function toResponse(s: SessionWithWork) {
  return {
    id:         s.id,
    oa_id:      s.oaId,
    work_id:    s.workId,
    work_title: s.work?.title ?? null,
    name:       s.name,
    status:     s.status,
    starts_at:  s.startsAt,
    ends_at:    s.endsAt,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLive(req, params.id, "read");
  if (!auth.ok) return auth.response;

  try {
    const sessions = await prisma.liveSession.findMany({
      where:   { oaId: params.id },
      orderBy: { createdAt: "desc" },
      include: { work: { select: { id: true, title: true } } },
      take:    100,
    });
    return ok({ sessions: sessions.map(toResponse) });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const data = createSessionSchema.parse(body);

    // workId が指定されたら OA 配下の Work であることを確認
    if (data.work_id) {
      const w = await prisma.work.findFirst({
        where:  { id: data.work_id, oaId: params.id },
        select: { id: true },
      });
      if (!w) return badRequest("work_id が OA に紐付いていません");
    }

    const session = await prisma.liveSession.create({
      data: {
        oaId:     params.id,
        workId:   data.work_id ?? null,
        name:     data.name,
        status:   data.status ?? "draft",
        startsAt: data.starts_at ? new Date(data.starts_at) : null,
        endsAt:   data.ends_at   ? new Date(data.ends_at)   : null,
      },
      include: { work: { select: { id: true, title: true } } },
    });
    return created(toResponse(session));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
