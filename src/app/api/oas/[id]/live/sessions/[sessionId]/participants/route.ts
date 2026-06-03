// src/app/api/oas/:id/live/sessions/:sessionId/participants/route.ts
// GET  — セッションの参加者一覧 (Phase 2-G: team / currentPhase 名 join)
// POST — 参加者追加
//
// 認可は親と同じ (platform admin / OA owner / live_owner / live_admin)。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const createParticipantSchema = z.object({
  display_name:        z.string().min(1).max(120).optional().nullable(),
  line_user_id:        z.string().min(1).max(120).optional().nullable(),
  status:              z.enum(["waiting", "active", "stuck", "completed", "dropped"]).optional(),
  current_step:        z.string().max(200).optional().nullable(),
  current_phase_id:    z.string().uuid().optional().nullable(),
  team_id:             z.string().uuid().optional().nullable(),
  reservation_number:  z.string().max(120).optional().nullable(),
  memo:                z.string().max(2000).optional().nullable(),
});

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

async function ensureSessionBelongsToOa(sessionId: string, oaId: string) {
  return prisma.liveSession.findFirst({
    where:  { id: sessionId, oaId },
    select: { id: true, workId: true },
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
    const participants = await prisma.liveParticipant.findMany({
      where:   { liveSessionId: params.sessionId },
      orderBy: { createdAt: "asc" },
      include: { currentPhase: { select: { id: true, name: true } } },
      take:    500,
    });
    return ok({ participants: participants.map(toResponse) });
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
    const data = createParticipantSchema.parse(body);

    // teamId / currentPhaseId の整合性検証
    if (data.team_id) {
      const t = await prisma.liveTeam.findFirst({
        where:  { id: data.team_id, liveSessionId: params.sessionId },
        select: { id: true },
      });
      if (!t) return badRequest("team_id がセッションに紐付いていません");
    }
    if (data.current_phase_id) {
      // workId が紐付いていれば、そのフェーズが同 Work 配下か確認
      const ph = await prisma.phase.findFirst({
        where:  session.workId
          ? { id: data.current_phase_id, workId: session.workId }
          : { id: data.current_phase_id },
        select: { id: true },
      });
      if (!ph) return badRequest("current_phase_id が選択中作品のフェーズではありません");
    }

    const participant = await prisma.liveParticipant.create({
      data: {
        oaId:               params.id,
        liveSessionId:      params.sessionId,
        teamId:             data.team_id ?? null,
        displayName:        data.display_name ?? null,
        lineUserId:         data.line_user_id ?? null,
        status:             data.status ?? "waiting",
        currentStep:        data.current_step ?? null,
        currentPhaseId:     data.current_phase_id ?? null,
        reservationNumber:  data.reservation_number ?? null,
        memo:               data.memo ?? null,
      },
      include: { currentPhase: { select: { id: true, name: true } } },
    });
    return created(toResponse(participant));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
