// src/app/api/oas/[id]/live/sessions/route.ts
// GET  /api/oas/:id/live/sessions — Live セッション一覧
// POST /api/oas/:id/live/sessions — Live セッション作成
//
// 認可:
//   GET  : platform admin / OA owner / live_owner / live_admin
//   POST : 同上 (= read/write 同集合)
// Live 無効 OA / 権限なしは 404 で存在を露出しない。

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
});

type SessionRow = {
  id: string;
  oaId: string;
  name: string;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toResponse(s: SessionRow) {
  return {
    id:         s.id,
    oa_id:      s.oaId,
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
    const session = await prisma.liveSession.create({
      data: {
        oaId:     params.id,
        name:     data.name,
        status:   data.status ?? "draft",
        startsAt: data.starts_at ? new Date(data.starts_at) : null,
        endsAt:   data.ends_at   ? new Date(data.ends_at)   : null,
      },
    });
    return created(toResponse(session));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
