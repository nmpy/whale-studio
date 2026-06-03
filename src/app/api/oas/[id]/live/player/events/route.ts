// src/app/api/oas/:id/live/player/events/route.ts
// POST /api/oas/:id/live/player/events — Player がイベントを記録する
//
// 認可: player section (= live_player / live_owner / OA owner / platform admin)
//
// 想定 event_type (= Player 寄り):
//   qr_scanned / checked_in / puzzle_solved / message_sent
// note_added / actor_contacted / alert も enum 上は許可するが UI には出さない (= 仕様上は Actor 寄り)。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { created, badRequest, notFound, serverError } from "@/lib/api-response";
import { authorizeLiveSection } from "@/lib/live-auth";

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
  session_id:     z.string().uuid("session_id は uuid"),
  type:           z.enum(LIVE_EVENT_TYPES),
  title:          z.string().min(1, "title は必須です").max(200),
  detail:         z.string().max(2000).optional().nullable(),
  participant_id: z.string().uuid().optional().nullable(),
  payload:        z.record(z.unknown()).optional().nullable(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLiveSection(req, params.id, "player");
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const data = createEventSchema.parse(body);

    // セッションが該当 OA に属することを確認 (= 横断アクセス防止)
    const session = await prisma.liveSession.findFirst({
      where:  { id: data.session_id, oaId: params.id },
      select: { id: true },
    });
    if (!session) return notFound("LiveSession");

    // participant_id が指定された場合、同セッション配下の参加者であることを確認
    if (data.participant_id) {
      const p = await prisma.liveParticipant.findFirst({
        where:  { id: data.participant_id, liveSessionId: data.session_id },
        select: { id: true },
      });
      if (!p) return badRequest("participant_id がセッションに紐付いていません");
    }

    const event = await prisma.liveEventLog.create({
      data: {
        oaId:          params.id,
        liveSessionId: data.session_id,
        participantId: data.participant_id ?? null,
        type:          data.type,
        title:         data.title,
        detail:        data.detail ?? null,
        ...(data.payload !== null && data.payload !== undefined
          ? { payload: data.payload as Prisma.InputJsonValue }
          : {}),
      },
    });

    return created({
      id:               event.id,
      oa_id:            event.oaId,
      live_session_id:  event.liveSessionId,
      participant_id:   event.participantId,
      type:             event.type,
      title:            event.title,
      detail:           event.detail,
      payload:          event.payload,
      created_at:       event.createdAt,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return badRequest(err.errors[0]?.message ?? "入力が不正です");
    }
    return serverError(err);
  }
}
