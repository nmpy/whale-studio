// src/app/api/oas/[id]/live/sessions/[sessionId]/teams/route.ts
// GET  — セッション配下のチーム一覧
// POST — チーム追加
//
// 認可: live admin 集合 (= authorizeLive)

import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";
import { createLiveTeamSchema, toLiveTeamResponse } from "@/lib/live-team";

export const dynamic = "force-dynamic";

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
    return ok({ teams: teams.map(toLiveTeamResponse) });
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
    const data = createLiveTeamSchema.parse(body);
    const team = await prisma.liveTeam.create({
      data: {
        oaId:              params.id,
        liveSessionId:     params.sessionId,
        name:              data.name,
        reservationNumber: data.reservation_number ?? null,
        memo:              data.memo ?? null,
        reservedAt:        data.reserved_at ? new Date(data.reserved_at) : null,
        purchaserName:     data.purchaser_name ?? null,
        groupType:         data.group_type ?? null,
        roomNumber:        data.room_number ?? null,
        ticketId:          data.ticket_id ?? null,
      },
    });
    return created(toLiveTeamResponse(team));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
