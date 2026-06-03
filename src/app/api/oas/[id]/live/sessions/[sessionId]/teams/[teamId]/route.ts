// src/app/api/oas/[id]/live/sessions/[sessionId]/teams/[teamId]/route.ts
// DELETE — チーム削除 (= participants は teamId=null になる / onDelete: SetNull)
// PATCH  — チーム編集 (name / reservationNumber / memo)
//
// 認可: live admin 集合。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, noContent, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const patchTeamSchema = z.object({
  name:               z.string().min(1).max(120).optional(),
  reservation_number: z.string().max(120).optional().nullable(),
  memo:               z.string().max(2000).optional().nullable(),
}).refine(
  (v) => v.name !== undefined || v.reservation_number !== undefined || v.memo !== undefined,
  { message: "少なくとも 1 つのフィールドを指定してください" },
);

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

async function findTeam(teamId: string, sessionId: string, oaId: string) {
  return prisma.liveTeam.findFirst({
    where:  { id: teamId, liveSessionId: sessionId, oaId },
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
    const data = patchTeamSchema.parse(body);

    const team = await prisma.liveTeam.update({
      where: { id: params.teamId },
      data: {
        ...(data.name               !== undefined ? { name:              data.name }               : {}),
        ...(data.reservation_number !== undefined ? { reservationNumber: data.reservation_number } : {}),
        ...(data.memo               !== undefined ? { memo:              data.memo }               : {}),
      },
    });
    return ok(toResponse(team));
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
