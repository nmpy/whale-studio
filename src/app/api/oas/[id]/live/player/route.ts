// src/app/api/oas/[id]/live/player/route.ts
// GET /api/oas/:id/live/player — Player 用サマリ取得
//
// 認可: player section (= live_player / live_owner / OA owner / platform admin)
// 返却:
//   sessions     : OA で active か直近の LiveSession (最大 50)
//   participants : 同 OA 内の LiveParticipant (= 自分の表示用)
//   events       : 同 OA 内の直近 LiveEventLog (最大 100)
//
// "自分に紐づく participant" / "自分に関連する event" の判定は、現状 schema には
// userId カラムが無く lineUserId / displayName ベースのため、Phase 2-B では
// OA 全体スコープでまとめて返し、UI 側で必要なら表示時にフィルタする。
// (= Player → Auth user 紐付け schema は将来の Phase で追加予定。)

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { authorizeLiveSection } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLiveSection(req, params.id, "player");
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");

    // sessionId が指定されればその session の参加者・イベントに絞る。
    // 指定なしなら OA 全体の最新ものを返す (= player UI が起動直後に状況把握できるように)。
    const [sessions, participants, events] = await Promise.all([
      prisma.liveSession.findMany({
        where:   { oaId: params.id },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take:    50,
      }),
      prisma.liveParticipant.findMany({
        where:   sessionId ? { oaId: params.id, liveSessionId: sessionId }
                           : { oaId: params.id },
        orderBy: { createdAt: "asc" },
        take:    200,
      }),
      prisma.liveEventLog.findMany({
        where:   sessionId ? { oaId: params.id, liveSessionId: sessionId }
                           : { oaId: params.id },
        orderBy: { createdAt: "desc" },
        take:    100,
      }),
    ]);

    return ok({
      sessions: sessions.map((s) => ({
        id:         s.id,
        oa_id:      s.oaId,
        name:       s.name,
        status:     s.status,
        starts_at:  s.startsAt,
        ends_at:    s.endsAt,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
      })),
      participants: participants.map((p) => ({
        id:               p.id,
        oa_id:            p.oaId,
        live_session_id:  p.liveSessionId,
        display_name:     p.displayName,
        line_user_id:     p.lineUserId,
        status:           p.status,
        current_step:     p.currentStep,
        last_seen_at:     p.lastSeenAt,
        created_at:       p.createdAt,
        updated_at:       p.updatedAt,
      })),
      events: events.map((e) => ({
        id:               e.id,
        oa_id:            e.oaId,
        live_session_id:  e.liveSessionId,
        participant_id:   e.participantId,
        type:             e.type,
        title:            e.title,
        detail:           e.detail,
        payload:          e.payload,
        created_at:       e.createdAt,
      })),
    });
  } catch (err) {
    return serverError(err);
  }
}
