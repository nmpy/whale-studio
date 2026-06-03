// src/app/api/oas/[id]/live/sessions/[sessionId]/instructions/route.ts
// GET  — セッション配下の Actor 向け指示一覧 (= 状態 / 作成日時 順)
// POST — 指示作成 (= participantId / actorId は任意で絞り込み)
//
// 認可: live admin 集合。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const createInstructionSchema = z.object({
  title:          z.string().min(1, "title は必須です").max(200),
  body:           z.string().min(1, "body は必須です").max(2000),
  priority:       z.enum(["low", "normal", "high"]).optional(),
  participant_id: z.string().uuid().optional().nullable(),
  actor_id:       z.string().uuid().optional().nullable(),
});

type InstructionRow = {
  id: string;
  oaId: string;
  liveSessionId: string;
  participantId: string | null;
  actorId: string | null;
  title: string;
  body: string;
  priority: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

function toResponse(i: InstructionRow) {
  return {
    id:               i.id,
    oa_id:            i.oaId,
    live_session_id:  i.liveSessionId,
    participant_id:   i.participantId,
    actor_id:         i.actorId,
    title:            i.title,
    body:             i.body,
    priority:         i.priority,
    status:           i.status,
    created_at:       i.createdAt,
    updated_at:       i.updatedAt,
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
    const instructions = await prisma.liveActorInstruction.findMany({
      where:   { liveSessionId: params.sessionId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take:    500,
    });
    return ok({ instructions: instructions.map(toResponse) });
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
    const data = createInstructionSchema.parse(body);

    if (data.participant_id) {
      const p = await prisma.liveParticipant.findFirst({
        where:  { id: data.participant_id, liveSessionId: params.sessionId, oaId: params.id },
        select: { id: true },
      });
      if (!p) return badRequest("participant_id がセッションに紐付いていません");
    }

    if (data.actor_id) {
      const a = await prisma.liveActor.findFirst({
        where:  { id: data.actor_id, oaId: params.id },
        select: { id: true },
      });
      if (!a) return badRequest("actor_id が OA に紐付いていません");
    }

    const instruction = await prisma.liveActorInstruction.create({
      data: {
        oaId:          params.id,
        liveSessionId: params.sessionId,
        participantId: data.participant_id ?? null,
        actorId:       data.actor_id       ?? null,
        title:         data.title,
        body:          data.body,
        priority:      data.priority ?? "normal",
      },
    });
    return created(toResponse(instruction));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
