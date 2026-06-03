// src/app/api/oas/:id/live/sessions/:sessionId/participants/:participantId/route.ts
// PATCH /api/oas/:id/live/sessions/:sessionId/participants/:participantId
//   — 既存 participant の編集 (Phase 2-G: team / current_phase / reservation_number も対応)
//
// 認可: 親 sessions と同じ (= platform admin / OA owner / live_owner / live_admin)。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const patchParticipantSchema = z.object({
  display_name:        z.string().max(120).optional().nullable(),
  line_user_id:        z.string().max(120).optional().nullable(),
  status:              z.enum(["waiting", "active", "stuck", "completed", "dropped"]).optional(),
  current_step:        z.string().max(200).optional().nullable(),
  current_phase_id:    z.string().uuid().optional().nullable(),
  team_id:             z.string().uuid().optional().nullable(),
  reservation_number:  z.string().max(120).optional().nullable(),
  memo:                z.string().max(2000).optional().nullable(),
}).refine(
  (v) =>
    v.display_name        !== undefined ||
    v.line_user_id        !== undefined ||
    v.status              !== undefined ||
    v.current_step        !== undefined ||
    v.current_phase_id    !== undefined ||
    v.team_id             !== undefined ||
    v.reservation_number  !== undefined ||
    v.memo                !== undefined,
  { message: "少なくとも 1 つのフィールドを指定してください" },
);

type ParticipantRow = {
  id: string;
  oaId: string;
  liveSessionId: string;
  teamId: string | null;
  displayName: string | null;
  lineUserId: string | null;
  status: string;
  currentStep: string | null;
  currentPhaseId: string | null;
  reservationNumber: string | null;
  memo: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  currentPhase: { id: string; name: string } | null;
};

function toResponse(p: ParticipantRow) {
  return {
    id:                 p.id,
    oa_id:              p.oaId,
    live_session_id:    p.liveSessionId,
    team_id:            p.teamId,
    display_name:       p.displayName,
    line_user_id:       p.lineUserId,
    status:             p.status,
    current_step:       p.currentStep,
    current_phase_id:   p.currentPhaseId,
    current_phase_name: p.currentPhase?.name ?? null,
    reservation_number: p.reservationNumber,
    memo:               p.memo,
    last_seen_at:       p.lastSeenAt,
    created_at:         p.createdAt,
    updated_at:         p.updatedAt,
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string; participantId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  const session = await prisma.liveSession.findFirst({
    where:  { id: params.sessionId, oaId: params.id },
    select: { id: true, workId: true },
  });
  if (!session) return notFound("LiveSession");

  const existing = await prisma.liveParticipant.findFirst({
    where:  { id: params.participantId, liveSessionId: params.sessionId, oaId: params.id },
    select: { id: true },
  });
  if (!existing) return notFound("LiveParticipant");

  try {
    const body = await req.json();
    const data = patchParticipantSchema.parse(body);

    if (data.team_id) {
      const t = await prisma.liveTeam.findFirst({
        where:  { id: data.team_id, liveSessionId: params.sessionId },
        select: { id: true },
      });
      if (!t) return badRequest("team_id がセッションに紐付いていません");
    }
    if (data.current_phase_id) {
      const ph = await prisma.phase.findFirst({
        where:  session.workId
          ? { id: data.current_phase_id, workId: session.workId }
          : { id: data.current_phase_id },
        select: { id: true },
      });
      if (!ph) return badRequest("current_phase_id が選択中作品のフェーズではありません");
    }

    const participant = await prisma.liveParticipant.update({
      where: { id: params.participantId },
      data: {
        ...(data.display_name        !== undefined ? { displayName:       data.display_name }        : {}),
        ...(data.line_user_id        !== undefined ? { lineUserId:        data.line_user_id }        : {}),
        ...(data.status              !== undefined ? { status:            data.status }              : {}),
        ...(data.current_step        !== undefined ? { currentStep:       data.current_step }        : {}),
        ...(data.current_phase_id    !== undefined ? { currentPhaseId:    data.current_phase_id }    : {}),
        ...(data.team_id             !== undefined ? { teamId:            data.team_id }             : {}),
        ...(data.reservation_number  !== undefined ? { reservationNumber: data.reservation_number }  : {}),
        ...(data.memo                !== undefined ? { memo:              data.memo }                : {}),
      },
      include: { currentPhase: { select: { id: true, name: true } } },
    });

    return ok(toResponse(participant));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
