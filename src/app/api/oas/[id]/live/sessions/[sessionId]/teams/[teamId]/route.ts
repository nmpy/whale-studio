// src/app/api/oas/[id]/live/sessions/[sessionId]/teams/[teamId]/route.ts
// DELETE — チーム削除 (= participants は teamId=null になる / onDelete: SetNull)
// PATCH  — チーム編集 (name / reservationNumber / memo)
//
// 認可: live admin 集合。

import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, noContent, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";
import { NATIVE_ORIGIN } from "@/lib/live-origin";
import { patchLiveTeamSchema, toLiveTeamResponse } from "@/lib/live-team";

export const dynamic = "force-dynamic";

// origin=NATIVE を条件に含め、UZU_PRO team は native API から 404 相当（編集/削除も不可）。
async function findTeam(teamId: string, sessionId: string, oaId: string) {
  return prisma.liveTeam.findFirst({
    where:  { id: teamId, liveSessionId: sessionId, oaId, origin: NATIVE_ORIGIN },
    select: { id: true },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string; teamId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  const existing = await findTeam(params.teamId, params.sessionId, params.id);
  if (!existing) return notFound("LiveTeam");

  try {
    const body = await req.json();
    const data = patchLiveTeamSchema.parse(body);

    const team = await prisma.liveTeam.update({
      where: { id: params.teamId },
      data: {
        ...(data.name               !== undefined ? { name:              data.name }               : {}),
        ...(data.reservation_number !== undefined ? { reservationNumber: data.reservation_number } : {}),
        ...(data.memo               !== undefined ? { memo:              data.memo }               : {}),
        ...(data.reserved_at        !== undefined ? { reservedAt:    data.reserved_at ? new Date(data.reserved_at) : null } : {}),
        ...(data.purchaser_name     !== undefined ? { purchaserName: data.purchaser_name } : {}),
        ...(data.group_type         !== undefined ? { groupType:     data.group_type }     : {}),
        ...(data.room_number        !== undefined ? { roomNumber:    data.room_number }    : {}),
        ...(data.ticket_id          !== undefined ? { ticketId:      data.ticket_id }      : {}),
      },
    });
    return ok(toLiveTeamResponse(team));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string; teamId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  const existing = await findTeam(params.teamId, params.sessionId, params.id);
  if (!existing) return notFound("LiveTeam");

  try {
    await prisma.liveTeam.delete({ where: { id: params.teamId } });
    return noContent();
  } catch (err) {
    return serverError(err);
  }
}
