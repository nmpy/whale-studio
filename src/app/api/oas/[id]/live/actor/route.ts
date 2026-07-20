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
import { NATIVE_ORIGIN } from "@/lib/live-origin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeLiveSection(req, params.id, "actor");
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");
    // Phase 2-J: Owner Actor Preview Mode. admin 集合のみ任意 Actor 視点に切替可。
    const previewActorIdRaw = url.searchParams.get("previewActorId");
    const canPreview =
      auth.via === "platform_admin" ||
      auth.via === "oa_owner"       ||
      auth.via === "live_owner"     ||
      auth.via === "live_admin";
    const previewActorId = canPreview ? previewActorIdRaw : null;

    // native 運用画面は NATIVE のみ集計（UZU_PRO の participant / team / session は露出しない）。
    const participantWhere = sessionId
      ? { oaId: params.id, liveSessionId: sessionId, origin: NATIVE_ORIGIN }
      : { oaId: params.id, origin: NATIVE_ORIGIN };

    // 選択中セッションが work に紐付くか確認 (= scripts / cues のスコープ決定用)
    const selectedSessionForWork = sessionId
      ? await prisma.liveSession.findFirst({
          where:  { id: sessionId, oaId: params.id, origin: NATIVE_ORIGIN },
          select: { workId: true },
        })
      : null;
    const scopedWorkId = selectedSessionForWork?.workId ?? null;

    const [
      sessions,
      participants,
      events,
      lastContacts,
      actors,
      assignments,
      instructions,
      teams,
      scripts,
      cues,
      phases,
    ] = await Promise.all([
      prisma.liveSession.findMany({
        where:   { oaId: params.id, origin: NATIVE_ORIGIN },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        include: { work: { select: { id: true, title: true } } },
        take:    50,
      }),
      prisma.liveParticipant.findMany({
        where:   participantWhere,
        orderBy: { createdAt: "asc" },
        include: { currentPhase: { select: { id: true, name: true } } },
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
      sessionId
        ? prisma.liveTeam.findMany({
            where:   { liveSessionId: sessionId, origin: NATIVE_ORIGIN },
            orderBy: { createdAt: "asc" },
            take:    200,
          })
        : Promise.resolve([]),
      // Phase 2-I.3: 「台本」を LiveCue に一本化。LiveScript は fetch せず空配列で返す。
      Promise.resolve([] as never[]),
      // Phase 2-I: cues (= work scope or OA 共通の active / 優先度高 → 低)
      prisma.liveCue.findMany({
        where:   scopedWorkId
          ? { oaId: params.id, isActive: true, OR: [{ workId: scopedWorkId }, { workId: null }] }
          : { oaId: params.id, isActive: true, workId: null },
        orderBy: [{ priority: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
        take:    500,
      }),
      // PR4-1: スタッフのフェーズ移動用に、選択公演の作品のフェーズ一覧を返す。
      scopedWorkId
        ? prisma.phase.findMany({
            where:   { workId: scopedWorkId },
            select:  { id: true, name: true, phaseType: true, sortOrder: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            take:    500,
          })
        : Promise.resolve([] as { id: string; name: string; phaseType: string; sortOrder: number }[]),
    ]);

    const lastContactByPid = new Map<string, Date | null>();
    for (const row of lastContacts) {
      if (row.participantId) {
        lastContactByPid.set(row.participantId, row._max.createdAt);
      }
    }

    // my_actor_ids: ログインユーザーに紐づく LiveActor の id (複数あり得る)
    // Phase 2-J: preview mode 時は admin 集合の閲覧者が「対象 Actor として」見るため、
    // my_actor_ids を [previewActorId] に上書き (= 同 OA に存在する場合のみ)。
    let myActorIds: string[];
    let previewActor: { id: string; display_name: string } | null = null;
    if (previewActorId) {
      const actor = actors.find((a) => a.id === previewActorId);
      if (actor) {
        myActorIds = [actor.id];
        previewActor = { id: actor.id, display_name: actor.displayName };
      } else {
        // 不正 / OA 外の actorId → preview 無効として通常挙動
        myActorIds = actors
          .filter((a) => a.userId === auth.user.id)
          .map((a) => a.id);
      }
    } else {
      myActorIds = actors
        .filter((a) => a.userId === auth.user.id)
        .map((a) => a.id);
    }

    return ok({
      sessions: sessions.map((s) => ({
        id:         s.id,
        oa_id:      s.oaId,
        work_id:    s.workId,
        work_title: s.work?.title ?? null,
        name:       s.name,
        status:     s.status,
        starts_at:  s.startsAt,
        ends_at:    s.endsAt,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
      })),
      participants: participants.map((p) => ({
        id:                 p.id,
        oa_id:              p.oaId,
        live_session_id:    p.liveSessionId,
        team_id:            p.teamId,
        display_name:       p.displayName,
        line_user_id:       p.lineUserId,
        status:             p.status,
        current_step:       p.currentStep,
        current_phase_id:   p.currentPhaseId,
        current_phase_name: p.currentPhase?.name ?? null,
        reservation_number: p.reservationNumber,
        memo:               p.memo,
        last_seen_at:       p.lastSeenAt,
        last_contact_at:    lastContactByPid.get(p.id) ?? null,
        created_at:         p.createdAt,
        updated_at:         p.updatedAt,
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
      teams: teams.map((t) => ({
        id:                 t.id,
        oa_id:              t.oaId,
        live_session_id:    t.liveSessionId,
        name:               t.name,
        reservation_number: t.reservationNumber,
        memo:               t.memo,
        // PR2b-0: 予約/部屋情報（スタッフ優先表示に使用）
        reserved_at:        t.reservedAt,
        purchaser_name:     t.purchaserName,
        group_type:         t.groupType,
        room_number:        t.roomNumber,
        ticket_id:          t.ticketId,
        created_at:         t.createdAt,
        updated_at:         t.updatedAt,
      })),
      // Phase 2-I.3: 「台本」を LiveCue に一本化。LiveScript は UI/API レベルで非表示化
      // (= DB データは残る / 後続 PR で整理予定)。scripts は空配列で互換維持。
      scripts: [],
      cues: cues.map((c) => ({
        id:         c.id,
        oa_id:      c.oaId,
        work_id:    c.workId,
        phase_id:   c.phaseId,
        actor_id:   c.actorId,
        title:      c.title,
        body:       c.body,
        priority:   c.priority,
        sort_order: c.sortOrder,
        is_active:  c.isActive,
        created_at: c.createdAt,
        updated_at: c.updatedAt,
      })),
      // PR4-1: スタッフのフェーズ移動 選択用
      phases: phases.map((p) => ({
        id:         p.id,
        name:       p.name,
        phase_type: p.phaseType,
        sort_order: p.sortOrder,
      })),
      my_actor_ids: myActorIds,
      // Phase 2-J: Owner Actor Preview Mode の状態
      preview: previewActor
        ? { actor_id: previewActor.id, actor_display_name: previewActor.display_name }
        : null,
      // canPreview = true なら UI に「表示確認モード」切替 UI を出す
      can_preview: canPreview,
    });
  } catch (err) {
    return serverError(err);
  }
}
