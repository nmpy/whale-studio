// src/app/api/oas/[id]/live/sessions/[sessionId]/teams/route.ts
// GET  — セッション配下のチーム一覧
// POST — チーム追加
//
// 認可: live admin 集合 (= authorizeLive)

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const createTeamSchema = z.object({
  name:               z.string().min(1, "name は必須です").max(120),
  reservation_number: z.string().max(120).optional().nullable(),
  memo:               z.string().max(2000).optional().nullable(),
});

type TeamRow = {
  id: string;
  oaId: string;
  liveSessionId: string;
  name: string;
  reservationNumber: string | null;
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toResponse(t: TeamRow) {
  return {
    id:                 t.id,
    oa_id:              t.oaId,
    live_session_id:    t.liveSessionId,
    name:               t.name,
    reservation_number: t.reservationNumber,
    memo:               t.memo,
    created_at:         t.createdAt,
    updated_at:         t.updatedAt,
  };
}

async function ensureSessionBelongsToOa(sessionId: string, oaId: string) {
  return prisma.liveSession.findFirst({
    where:  { id: sessionId, oaId },
    select: { id: true },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string } },
) {
  const auth = await authorizeLive(req, params.id, "read");
  if (!auth.ok) return auth.response;

  const session = await ensureSessionBelongsToOa(params.sessionId, params.id);
  if (!session) return notFound("LiveSession");

  try {
    const teams = await prisma.liveTeam.findMany({
      where:   { liveSessionId: params.sessionId },
      orderBy: { createdAt: "asc" },
      take:    500,
    });
    return ok({ teams: teams.map(toResponse) });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  const session = await ensureSessionBelongsToOa(params.sessionId, params.id);
  if (!session) return notFound("LiveSession");

  try {
    const body = await req.json();
    const data = createTeamSchema.parse(body);
    const team = await prisma.liveTeam.create({
      data: {
        oaId:              params.id,
        liveSessionId:     params.sessionId,
        name:              data.name,
        reservationNumber: data.reservation_number ?? null,
        memo:              data.memo ?? null,
      },
    });
    return created(toResponse(team));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
