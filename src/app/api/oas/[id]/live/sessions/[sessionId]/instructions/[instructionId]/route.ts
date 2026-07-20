// src/app/api/oas/[id]/live/sessions/[sessionId]/instructions/[instructionId]/route.ts
// PATCH — Admin が指示を更新 (= title / body / priority / status / actor / participant)
//
// 認可: live admin 集合。
// Actor 経路の done 更新は別ファイル /actor/route.ts で受ける。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";
import { NATIVE_ORIGIN } from "@/lib/live-origin";

export const dynamic = "force-dynamic";

const patchInstructionSchema = z.object({
  title:          z.string().min(1).max(200).optional(),
  body:           z.string().min(1).max(2000).optional(),
  priority:       z.enum(["low", "normal", "high"]).optional(),
  status:         z.enum(["active", "done", "archived"]).optional(),
  participant_id: z.string().uuid().optional().nullable(),
  actor_id:       z.string().uuid().optional().nullable(),
}).refine(
  (v) =>
    v.title       !== undefined ||
    v.body        !== undefined ||
    v.priority    !== undefined ||
    v.status      !== undefined ||
    v.participant_id !== undefined ||
    v.actor_id    !== undefined,
  { message: "少なくとも 1 つのフィールドを指定してください" },
);

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string; instructionId: string } },
) {
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  const existing = await prisma.liveActorInstruction.findFirst({
    where:  { id: params.instructionId, liveSessionId: params.sessionId, oaId: params.id },
    select: { id: true },
  });
  if (!existing) return notFound("LiveActorInstruction");

  try {
    const body = await req.json();
    const data = patchInstructionSchema.parse(body);

    if (data.participant_id) {
      const p = await prisma.liveParticipant.findFirst({
        where:  { id: data.participant_id, liveSessionId: params.sessionId, oaId: params.id, origin: NATIVE_ORIGIN },
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

    const instruction = await prisma.liveActorInstruction.update({
      where: { id: params.instructionId },
      data: {
        ...(data.title          !== undefined ? { title:          data.title          } : {}),
        ...(data.body           !== undefined ? { body:           data.body           } : {}),
        ...(data.priority       !== undefined ? { priority:       data.priority       } : {}),
        ...(data.status         !== undefined ? { status:         data.status         } : {}),
        ...(data.participant_id !== undefined ? { participantId:  data.participant_id } : {}),
        ...(data.actor_id       !== undefined ? { actorId:        data.actor_id       } : {}),
      },
    });
    return ok(toResponse(instruction));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
