// src/app/api/oas/[id]/live/sessions/[sessionId]/participants/[participantId]/actor/route.ts
// PATCH — Actor が participant の状態 / メモ / ステップを更新する
//
// Phase 2-C で追加した PATCH 本体 (= 同階層 /participants/:participantId/route.ts) は
// Admin 権限 (= authorizeLive) を要求する。本ファイルは actor section の権限で
// **更新フィールドを限定して** 同等操作を提供する。
//
// 認可: actor section (= live_actor / live_owner / OA owner / platform admin)
// 更新可能: status / memo / current_step
//   display_name / line_user_id は Admin のみが触る (= Actor 経路では弾く)
//
// 接触履歴 (last_contact_at) は本 endpoint では直接更新しない。
// Actor が「接触済み」を記録するときは POST /api/oas/[id]/live/actor/events
// (type='actor_contacted') を呼び、GET 側でその MAX(createdAt) を last_contact_at として返す。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { authorizeLiveSection } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const patchActorParticipantSchema = z.object({
  status:        z.enum(["waiting", "active", "stuck", "completed", "dropped"]).optional(),
  memo:          z.string().max(2000).optional().nullable(),
  current_step:  z.string().max(200).optional().nullable(),
}).refine(
  (v) => v.status !== undefined || v.memo !== undefined || v.current_step !== undefined,
  { message: "少なくとも 1 つのフィールドを指定してください" },
);

type ParticipantRow = {
  id: string;
  oaId: string;
  liveSessionId: string;
  displayName: string | null;
  lineUserId: string | null;
  status: string;
  currentStep: string | null;
  memo: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toResponse(p: ParticipantRow) {
  return {
    id:               p.id,
    oa_id:            p.oaId,
    live_session_id:  p.liveSessionId,
    display_name:     p.displayName,
    line_user_id:     p.lineUserId,
    status:           p.status,
    current_step:     p.currentStep,
    memo:             p.memo,
    last_seen_at:     p.lastSeenAt,
    created_at:       p.createdAt,
    updated_at:       p.updatedAt,
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string; participantId: string } },
) {
  const auth = await authorizeLiveSection(req, params.id, "actor");
  if (!auth.ok) return auth.response;

  // session + participant が OA / session 階層に紐付くことを毎回検証 (= 横断アクセス防止)
  const session = await prisma.liveSession.findFirst({
    where:  { id: params.sessionId, oaId: params.id },
    select: { id: true },
  });
  if (!session) return notFound("LiveSession");

  const existing = await prisma.liveParticipant.findFirst({
    where:  { id: params.participantId, liveSessionId: params.sessionId, oaId: params.id },
    select: { id: true },
  });
  if (!existing) return notFound("LiveParticipant");

  try {
    const body = await req.json();
    const data = patchActorParticipantSchema.parse(body);

    const participant = await prisma.liveParticipant.update({
      where: { id: params.participantId },
      data: {
        ...(data.status       !== undefined ? { status:      data.status       } : {}),
        ...(data.memo         !== undefined ? { memo:        data.memo         } : {}),
        ...(data.current_step !== undefined ? { currentStep: data.current_step } : {}),
      },
    });

    return ok(toResponse(participant));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
