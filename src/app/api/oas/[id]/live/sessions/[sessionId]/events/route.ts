// src/app/api/oas/:id/live/sessions/:sessionId/events/route.ts
// GET  — セッションのイベントログ一覧
// POST — イベントログ追加 (テスト・手動投入想定)
//
// 認可は親と同じ (platform admin / OA owner / live_owner / live_admin)。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ok, created, badRequest, notFound, serverError } from "@/lib/api-response";
import { authorizeLive } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

const LIVE_EVENT_TYPES = [
  "qr_scanned",
  "checked_in",
  "puzzle_solved",
  "message_sent",
  "actor_contacted",
  "note_added",
  "alert",
] as const;

const createEventSchema = z.object({
  type:           z.enum(LIVE_EVENT_TYPES),
  title:          z.string().min(1, "title は必須です").max(200),
  detail:         z.string().max(2000).optional().nullable(),
  participant_id: z.string().uuid().optional().nullable(),
  payload:        z.record(z.unknown()).optional().nullable(),
});

type EventRow = {
  id: string;
  oaId: string;
  liveSessionId: string | null;
  participantId: string | null;
  type: string;
  title: string;
  detail: string | null;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
};

function toResponse(e: EventRow) {
  return {
    id:               e.id,
    oa_id:            e.oaId,
    live_session_id:  e.liveSessionId,
    participant_id:   e.participantId,
    type:             e.type,
    title:            e.title,
    detail:           e.detail,
    payload:          e.payload,
    created_at:       e.createdAt,
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
    const events = await prisma.liveEventLog.findMany({
      where:   { liveSessionId: params.sessionId },
      orderBy: { createdAt: "desc" },
      take:    200,
    });
    return ok({ events: events.map(toResponse) });
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
    const data = createEventSchema.parse(body);

    // participantId が指定された場合、同セッション配下の参加者であることを確認
    if (data.participant_id) {
      const p = await prisma.liveParticipant.findFirst({
        where:  { id: data.participant_id, liveSessionId: params.sessionId },
        select: { id: true },
      });
      if (!p) return badRequest("participant_id がセッションに紐付いていません");
    }

    const event = await prisma.liveEventLog.create({
      data: {
        oaId:          params.id,
        liveSessionId: params.sessionId,
        participantId: data.participant_id ?? null,
        type:          data.type,
        title:         data.title,
        detail:        data.detail ?? null,
        ...(data.payload !== null && data.payload !== undefined
          ? { payload: data.payload as Prisma.InputJsonValue }
          : {}),
      },
    });
    return created(toResponse(event));
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
