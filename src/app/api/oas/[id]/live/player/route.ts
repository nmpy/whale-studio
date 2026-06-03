// src/app/api/oas/[id]/live/player/route.ts
// GET /api/oas/:id/live/player — Player 用サマリ取得
//
// 認可: player section (= live_player / live_owner / OA owner / platform admin)
// 返却:
//   sessions       : OA の LiveSession 一覧 (= UI のセッション選択用)
//   participants   : 同 OA 内の LiveParticipant (= "他の参加者" 含む一覧表示用)
//   events         : 同 OA 内の直近 LiveEventLog
//   me             : 自分に紐づく LiveParticipant 1 件 / 曖昧時 or 未紐付け時は null
//   me_candidates  : 自分に紐づく LiveParticipant 一覧 (= 複数セッション参加時の UI 表示用)
//   me_ambiguous   : true なら me_candidates が複数で sessionId が指定されていない状態
//                    (= UI は「参加セッションを選択してください」を案内する)
//
// Phase 2-B.5 拡張:
//   - 同じ authUserId は OA 内の複数セッションに存在し得る (= 同一 Player が複数公演に参加 など)。
//   - そのため me 解決は (oaId, authUserId) だけでなく liveSessionId も含める。
//   - sessionId 指定時:
//       me = (oaId, sessionId, authUserId) 一致の 1 件
//   - sessionId 未指定時:
//       1) 紐付き候補 (me_candidates) を全件取得
//       2) status='active' のものを優先。1 件のみなら me に確定
//       3) active が 2 件以上 → 曖昧 (me=null / me_ambiguous=true)
//       4) active 0 件なら全候補の最新 createdAt を me として返す
//       5) 候補ゼロ なら me=null / me_ambiguous=false (= 未紐付け)
//
// 注意:
//   - クライアント由来の participant_id は POST 側でも信用しない (= なりすまし防止)。
//   - 未紐付け時は POST 側で 409 を返す挙動と組み合わせて整合性を担保。

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

    // me_candidates: 同 OA 内で自分の authUserId に紐づく participant を全件。
    // session の status を join 的に取りたいため、include で session を引いておく。
    const [sessions, participants, events, candidates] = await Promise.all([
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
      prisma.liveParticipant.findMany({
        where:   { oaId: params.id, authUserId: auth.user.id },
        include: { liveSession: { select: { id: true, status: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // ── me 解決 ─────────────────────────────────────────────────────────────
    let me: typeof candidates[number] | null = null;
    let meAmbiguous = false;

    if (sessionId) {
      // sessionId 指定時: そのセッション配下の候補 1 件のみが me
      me = candidates.find((c) => c.liveSessionId === sessionId) ?? null;
    } else if (candidates.length > 0) {
      const activeCandidates = candidates.filter((c) => c.liveSession.status === "active");
      if (activeCandidates.length === 1) {
        me = activeCandidates[0];
      } else if (activeCandidates.length >= 2) {
        // active が 2 件以上 → 曖昧。UI でセッション選択を促す。
        me = null;
        meAmbiguous = true;
      } else {
        // active 0 件 → 全候補のうち最新 createdAt (= candidates は createdAt desc で取得済み)
        me = candidates[0];
      }
    }

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
      me_candidates: candidates.map(toParticipantResponse),
      me_ambiguous: meAmbiguous,
    });
  } catch (err) {
    return serverError(err);
  }
}
