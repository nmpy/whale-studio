// src/app/api/oas/:id/live/player/events/route.ts
// POST /api/oas/:id/live/player/events — Player がイベントを記録する
//
// 認可: player section (= live_player / live_owner / OA owner / platform admin)
//
// Phase 2-B.5 で identity 解決を追加:
//   - 通常の Player (= via=live_player): サーバー側で auth.user.id → LiveParticipant.authUserId
//     一致の participant を必須解決。未紐付けなら 409 (= 明示エラー)。
//     クライアント由来の participant_id は無視 (= 他人なりすまし防止)。
//   - 特権 (= via=platform_admin / oa_owner / live_owner): テスト目的で任意の participant_id
//     を指定可。authUserId 紐付けがあればそちらを優先する。
//
// 想定 event_type (= Player 寄り):
//   qr_scanned / checked_in / puzzle_solved / message_sent
// note_added / actor_contacted / alert も enum 上は許可するが UI には出さない (= 仕様上は Actor 寄り)。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { created, badRequest, conflict, notFound, serverError } from "@/lib/api-response";
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

    // ── participant 解決 ─────────────────────────────────────────────
    // 自分 (auth.user.id) に紐づく participant を最初に検索。
    const myParticipant = await prisma.liveParticipant.findFirst({
      where:  { oaId: params.id, liveSessionId: data.session_id, authUserId: auth.user.id },
      select: { id: true },
    });

    let resolvedParticipantId: string | null = null;

    if (myParticipant) {
      // 自分の participant があれば、それを使う (= クライアント指定値は無視)
      resolvedParticipantId = myParticipant.id;
    } else if (auth.via === "live_player") {
      // 通常 Player で紐付けが無い場合は明示エラー
      return conflict(
        "あなたの参加者情報が登録されていません。運営に依頼して参加者として登録してもらってください。",
      );
    } else if (data.participant_id) {
      // 特権ユーザー (= owner / admin / live_owner) はテスト用に participant_id を任意指定可
      const p = await prisma.liveParticipant.findFirst({
        where:  { id: data.participant_id, liveSessionId: data.session_id },
        select: { id: true },
      });
      if (!p) return badRequest("participant_id がセッションに紐付いていません");
      resolvedParticipantId = p.id;
    }
    // 特権ユーザーが participant_id を指定しなかった場合は null のまま (= OA 単位のイベント)

    const event = await prisma.liveEventLog.create({
      data: {
        oaId:          params.id,
        liveSessionId: data.session_id,
        participantId: resolvedParticipantId,
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
