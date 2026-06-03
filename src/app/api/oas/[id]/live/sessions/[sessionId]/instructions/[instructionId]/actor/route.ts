// src/app/api/oas/[id]/live/sessions/[sessionId]/instructions/[instructionId]/actor/route.ts
// PATCH — Actor が指示を「完了 / 再アクティブ化」する (= status のみ active|done 更新可)
//
// 認可: actor section (= live_actor / live_owner / OA owner / platform admin)
// 更新可能フィールドを status: "active" | "done" のみに制限。
// "archived" は Admin 専用。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { authorizeLiveSection } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const patchActorInstructionSchema = z.object({
  status: z.enum(["active", "done"]),
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string; instructionId: string } },
) {
  const auth = await authorizeLiveSection(req, params.id, "actor");
  if (!auth.ok) return auth.response;

  const existing = await prisma.liveActorInstruction.findFirst({
    where:  { id: params.instructionId, liveSessionId: params.sessionId, oaId: params.id },
    select: { id: true },
  });
  if (!existing) return notFound("LiveActorInstruction");

  try {
    const body = await req.json();
    const data = patchActorInstructionSchema.parse(body);

    const instruction = await prisma.liveActorInstruction.update({
      where: { id: params.instructionId },
      data:  { status: data.status },
    });
    return ok(toResponse(instruction));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
