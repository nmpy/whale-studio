// src/app/api/oas/[id]/live/actor/route.ts
// GET /api/oas/:id/live/actor — Actor 用サマリ取得
//
// 認可: actor section (= live_actor / live_owner / OA owner / platform admin)
// 返却:
//   sessions     : OA の LiveSession (最大 50 / status / createdAt 昇順)
//   participants : 同 OA の LiveParticipant + last_contact_at (= 演者が状況把握する対象)
//   events       : 同 OA の直近 LiveEventLog (最大 100 / 演者向け actor_contacted / alert / note_added を含む)
//
// Phase 2-D 拡張:
//   participants[].last_contact_at — 当該 participant に対する最新の
//     LiveEventLog.type='actor_contacted' の createdAt を server-side で算出。
//     新規列を増やさず、event 履歴から導出する設計 (= migration 不要)。

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ok, serverError } from "@/lib/api-response";
import { authorizeLiveSection } from "@/lib/live-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLiveSection(req, params.id, "actor");
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");

    const participantWhere = sessionId
      ? { oaId: params.id, liveSessionId: sessionId }
      : { oaId: params.id };

    const [sessions, participants, events, lastContacts] = await Promise.all([
      prisma.liveSession.findMany({
        where:   { oaId: params.id },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take:    50,
      }),
      prisma.liveParticipant.findMany({
        where:   participantWhere,
        orderBy: { createdAt: "asc" },
        take:    200,
      }),
      prisma.liveEventLog.findMany({
        where:   sessionId ? { oaId: params.id, liveSessionId: sessionId }
                           : { oaId: params.id },
        orderBy: { createdAt: "desc" },
        take:    100,
      }),
      // 各 participant に対する最新の actor_contacted イベントの created_at を取得。
      // event 履歴の上限 (= 100 件) に影響されないよう、専用クエリで取得する。
      prisma.liveEventLog.groupBy({
        by:    ["participantId"],
        where: {
          ...(sessionId ? { liveSessionId: sessionId } : { oaId: params.id }),
          type:          "actor_contacted",
          participantId: { not: null },
        },
        _max: { createdAt: true },
      }),
    ]);

    // groupBy の結果を Map<participantId, lastContactAt> に変換
    const lastContactByPid = new Map<string, Date | null>();
    for (const row of lastContacts) {
      if (row.participantId) {
        lastContactByPid.set(row.participantId, row._max.createdAt);
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
      participants: participants.map((p) => ({
        id:               p.id,
        oa_id:            p.oaId,
        live_session_id:  p.liveSessionId,
        display_name:     p.displayName,
        line_user_id:     p.lineUserId,
        status:           p.status,
        current_step:     p.currentStep,
        memo:             p.memo,
        last_seen_at:     p.lastSeenAt,
        // Phase 2-D: events から導出した「最後に接触した時刻」
        last_contact_at:  lastContactByPid.get(p.id) ?? null,
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
