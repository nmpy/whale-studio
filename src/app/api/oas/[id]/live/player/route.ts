// src/app/api/oas/[id]/live/player/route.ts
// GET /api/oas/:id/live/player — Player 用サマリ取得
//
// 認可: player section (= live_player / live_owner / OA owner / platform admin)
// 返却:
//   sessions     : OA で active か直近の LiveSession (最大 50)
//   participants : 同 OA 内の LiveParticipant (= 一覧表示用 / "他の参加者" 含む)
//   events       : 同 OA 内の直近 LiveEventLog (最大 100)
//   me           : ログイン中の Auth user に authUserId で紐づく LiveParticipant、無ければ null
//                  (= Phase 2-B.5 で追加。"自分に紐づく participant" を安全に特定する)
//
// 注意:
//   - participants が「自分」かどうかは認証ユーザーに対して LiveParticipant.authUserId 一致で判定する。
//   - authUserId が未紐付け (= Admin が email だけ登録 / 旧 participant) の場合、me=null になる。
//     UI は me=null のときは "参加者情報が紐付いていません" を案内し、イベント送信は無効化する想定。

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { authorizeLiveSection } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

type ParticipantRow = {
  id: string;
  oaId: string;
  liveSessionId: string;
  displayName: string | null;
  lineUserId: string | null;
  authUserId: string | null;
  email: string | null;
  status: string;
  currentStep: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toParticipantResponse(p: ParticipantRow) {
  return {
    id:               p.id,
    oa_id:            p.oaId,
    live_session_id:  p.liveSessionId,
    display_name:     p.displayName,
    line_user_id:     p.lineUserId,
    auth_user_id:     p.authUserId,
    email:            p.email,
    status:           p.status,
    current_step:     p.currentStep,
    last_seen_at:     p.lastSeenAt,
    created_at:       p.createdAt,
    updated_at:       p.updatedAt,
  };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLiveSection(req, params.id, "player");
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");

    const baseWhere = sessionId
      ? { oaId: params.id, liveSessionId: sessionId }
      : { oaId: params.id };

    const [sessions, participants, events, me] = await Promise.all([
      prisma.liveSession.findMany({
        where:   { oaId: params.id },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take:    50,
      }),
      prisma.liveParticipant.findMany({
        where:   baseWhere,
        orderBy: { createdAt: "asc" },
        take:    200,
      }),
      prisma.liveEventLog.findMany({
        where:   baseWhere,
        orderBy: { createdAt: "desc" },
        take:    100,
      }),
      // 自分に紐づく participant を特定する。
      // sessionId 指定があればそのセッション配下のもの、なければ OA 内で最新のものを 1 件。
      prisma.liveParticipant.findFirst({
        where: sessionId
          ? { oaId: params.id, liveSessionId: sessionId, authUserId: auth.user.id }
          : { oaId: params.id, authUserId: auth.user.id },
        orderBy: { createdAt: "desc" },
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
      participants: participants.map(toParticipantResponse),
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
      me: me ? toParticipantResponse(me) : null,
    });
  } catch (err) {
    return serverError(err);
  }
}
