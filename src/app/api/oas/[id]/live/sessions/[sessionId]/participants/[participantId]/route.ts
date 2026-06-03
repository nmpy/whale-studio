// src/app/api/oas/:id/live/sessions/:sessionId/participants/:participantId/route.ts
// PATCH /api/oas/:id/live/sessions/:sessionId/participants/:participantId
//   — 既存 participant の編集 (display_name / line_user_id / status / current_step / memo)
//
// 認可: 親 sessions と同じ (= platform admin / OA owner / live_owner / live_admin)。
// 横断アクセス防止のため、参加者が指定セッション (= 指定 OA) に紐付くことを毎回検証する。
//
// Phase 2-C 新設。「LiveParticipant = 運営が管理する体験参加者レコード」として、
// Admin が任意フィールドを部分更新できるようにする。未指定フィールドは触らない (= no-op)。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const patchParticipantSchema = z.object({
  display_name:  z.string().max(120).optional().nullable(),
  line_user_id:  z.string().max(120).optional().nullable(),
  status:        z.enum(["waiting", "active", "stuck", "completed", "dropped"]).optional(),
  current_step:  z.string().max(200).optional().nullable(),
  memo:          z.string().max(2000).optional().nullable(),
}).refine(
  (v) =>
    v.display_name !== undefined ||
    v.line_user_id !== undefined ||
    v.status       !== undefined ||
    v.current_step !== undefined ||
    v.memo         !== undefined,
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
  const auth = await authorizeLive(req, params.id, "write");
  if (!auth.ok) return auth.response;

  // 親セッション + 参加者が該当 OA 配下に紐付くことを確認
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
    const data = patchParticipantSchema.parse(body);

    const participant = await prisma.liveParticipant.update({
      where: { id: params.participantId },
      data: {
        ...(data.display_name !== undefined ? { displayName: data.display_name } : {}),
        ...(data.line_user_id !== undefined ? { lineUserId:  data.line_user_id } : {}),
        ...(data.status       !== undefined ? { status:      data.status       } : {}),
        ...(data.current_step !== undefined ? { currentStep: data.current_step } : {}),
        ...(data.memo         !== undefined ? { memo:        data.memo         } : {}),
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
