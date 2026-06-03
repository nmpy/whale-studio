// src/app/api/oas/[id]/live/actor/route.ts
// GET /api/oas/:id/live/actor — Actor 用サマリ取得
//
// 認可: actor section (= live_actor / live_owner / OA owner / platform admin)
//
// 返却:
//   sessions       : OA の LiveSession (最大 50)
//   participants   : 同 OA の LiveParticipant + last_contact_at
//   events         : 同 OA の直近 LiveEventLog (最大 100)
//   assignments    : 同セッションの participant ↔ actor の担当割当
//   instructions   : 同セッションの Actor 向け指示 (= active を優先 / 最大 200)
//   actors         : 同 OA の LiveActor 一覧 (= UI で actor 名を引くため)
//   my_actor_ids   : ログイン user.id に紐づく LiveActor の id 配列 (= 自分宛て判定用 / 0 件もあり)
//
// Phase 2-E 拡張:
//   - my_actor_ids: auth.user.id と LiveActor.userId が一致するもの (= 「自分」と特定)
//   - UI は my_actor_ids 配下の assignments で participant を優先表示
//   - "未紐付け" Actor (= my_actor_ids が空) は従来通り全 participant 閲覧

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

    const [
      sessions,
      participants,
      events,
      lastContacts,
      actors,
      assignments,
      instructions,
    ] = await Promise.all([
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
      prisma.liveEventLog.groupBy({
        by:    ["participantId"],
        where: {
          ...(sessionId ? { liveSessionId: sessionId } : { oaId: params.id }),
          type:          "actor_contacted",
          participantId: { not: null },
        },
        _max: { createdAt: true },
      }),
      prisma.liveActor.findMany({
        where:   { oaId: params.id },
        orderBy: { createdAt: "asc" },
        take:    200,
      }),
      sessionId
        ? prisma.liveAssignment.findMany({
            where:   { liveSessionId: sessionId },
            orderBy: { createdAt: "asc" },
            take:    500,
          })
        : Promise.resolve([]),
      sessionId
        ? prisma.liveActorInstruction.findMany({
            where:   { liveSessionId: sessionId },
            orderBy: [{ status: "asc" }, { createdAt: "desc" }],
            take:    200,
          })
        : Promise.resolve([]),
    ]);

    const lastContactByPid = new Map<string, Date | null>();
    for (const row of lastContacts) {
      if (row.participantId) {
        lastContactByPid.set(row.participantId, row._max.createdAt);
      }
    }

    // my_actor_ids: ログインユーザーに紐づく LiveActor の id (複数あり得る)
    const myActorIds = actors
      .filter((a) => a.userId === auth.user.id)
      .map((a) => a.id);

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
      actors: actors.map((a) => ({
        id:             a.id,
        oa_id:          a.oaId,
        display_name:   a.displayName,
        user_id:        a.userId,
        character_name: a.characterName,
        memo:           a.memo,
        created_at:     a.createdAt,
        updated_at:     a.updatedAt,
      })),
      assignments: assignments.map((a) => ({
        id:               a.id,
        oa_id:            a.oaId,
        live_session_id:  a.liveSessionId,
        participant_id:   a.participantId,
        actor_id:         a.actorId,
        note:             a.note,
        created_at:       a.createdAt,
        updated_at:       a.updatedAt,
      })),
      instructions: instructions.map((i) => ({
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
      })),
      my_actor_ids: myActorIds,
    });
  } catch (err) {
    return serverError(err);
  }
}
