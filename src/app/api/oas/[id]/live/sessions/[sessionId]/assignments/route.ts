// src/app/api/oas/[id]/live/sessions/[sessionId]/assignments/route.ts
// GET  — セッション配下の participant ↔ actor の担当割当一覧
// POST — 担当割当を追加 (同セッション内 participant+actor の組合せは unique 制約)
//
// 認可: live admin 集合。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, conflict, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const createAssignmentSchema = z.object({
  participant_id: z.string().uuid("participant_id は uuid"),
  actor_id:       z.string().uuid("actor_id は uuid"),
  note:           z.string().max(2000).optional().nullable(),
});

type AssignmentRow = {
  id: string;
  oaId: string;
  liveSessionId: string;
  participantId: string;
  actorId: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toResponse(a: AssignmentRow) {
  return {
    id:               a.id,
    oa_id:            a.oaId,
    live_session_id:  a.liveSessionId,
    participant_id:   a.participantId,
    actor_id:         a.actorId,
    note:             a.note,
    created_at:       a.createdAt,
    updated_at:       a.updatedAt,
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
    const assignments = await prisma.liveAssignment.findMany({
      where:   { liveSessionId: params.sessionId },
      orderBy: { createdAt: "asc" },
      take:    500,
    });
    return ok({ assignments: assignments.map(toResponse) });
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
    const data = createAssignmentSchema.parse(body);

    // participant が同セッション・同 OA 配下か確認
    const p = await prisma.liveParticipant.findFirst({
      where:  { id: data.participant_id, liveSessionId: params.sessionId, oaId: params.id },
      select: { id: true },
    });
    if (!p) return badRequest("participant_id がセッションに紐付いていません");

    // actor が同 OA 配下か確認
    const a = await prisma.liveActor.findFirst({
      where:  { id: data.actor_id, oaId: params.id },
      select: { id: true },
    });
    if (!a) return badRequest("actor_id が OA に紐付いていません");

    const assignment = await prisma.liveAssignment.create({
      data: {
        oaId:          params.id,
        liveSessionId: params.sessionId,
        participantId: data.participant_id,
        actorId:       data.actor_id,
        note:          data.note ?? null,
      },
    });
    return created(toResponse(assignment));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict("この participant と actor の組合せは既に割り当てられています");
    }
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
