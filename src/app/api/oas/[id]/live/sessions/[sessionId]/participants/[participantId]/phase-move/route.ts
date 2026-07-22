// src/app/api/oas/[id]/live/sessions/[sessionId]/participants/[participantId]/phase-move/route.ts
//
// POST — スタッフによる実フェーズ移動（PR4-1）。
//   対象プレイヤーの実 UserProgress.currentPhaseId を移動先へ更新し、基本的に移動先フェーズ冒頭の
//   メッセージを LINE に push する（プレイヤーに見える形での復旧/移動）。
//
// 認可: actor section（live_actor / live_owner / OA owner / platform admin）。当日スタッフが介入するため。
// 対象: lineUserId が紐づいた LiveParticipant のみ。
//
// 設計: webhook のフェーズ入場（route.ts の image→phase 遷移）と同じ
//   fetchPhaseWithIncludes → UserProgress 更新 → buildRuntimeState → buildPhaseMessages の流れ。
//   ただし replyToken を持たないため配信は pushToLine に差し替える（前例: consumeCheckinTrigger）。
//   同期は webhook を経由しないため、LiveParticipant 側も直接更新する。

import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";
import { authorizeLiveSection } from "@/lib/live-auth";
import { NATIVE_ORIGIN } from "@/lib/live-origin";
import { fetchPhaseWithIncludes, buildRuntimeState } from "@/lib/runtime";
import { buildPhaseMessages, pushToLine, type LineSender, type PlaceholderVars } from "@/lib/line";
import { applyFreeInputPostEffect } from "@/lib/frontier-effect";
import { activeCache, CACHE_KEY } from "@/lib/cache";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  target_phase_id: z.string().uuid("target_phase_id は uuid"),
  // 既定 true = 移動先フェーズ冒頭メッセージを push。false = 内部状態だけ移動（後続 UI 用）。
  send_messages:   z.boolean().optional().default(true),
});

/** LINE プロフィール表示名を取得（プレースホルダ {user_name} 用）。失敗時は空文字。 */
async function fetchDisplayName(userId: string, token: string): Promise<string> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return "";
    const j = await res.json().catch(() => null);
    return typeof j?.displayName === "string" ? j.displayName : "";
  } catch {
    return "";
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string; participantId: string } },
) {
  const auth = await authorizeLiveSection(req, params.id, "actor");
  if (!auth.ok) return auth.response;

  let data: z.infer<typeof bodySchema>;
  try {
    data = bodySchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) return badRequest(err.errors[0]?.message ?? "入力が不正です");
    return badRequest("リクエストボディが不正です");
  }

  try {
    // 1. participant（当該 session/OA・lineUserId 紐づき済みのみ）
    const participant = await prisma.liveParticipant.findFirst({
      where:  { id: params.participantId, liveSessionId: params.sessionId, oaId: params.id, origin: NATIVE_ORIGIN },
      select: { id: true, lineUserId: true, currentPhaseId: true },
    });
    if (!participant) return notFound("LiveParticipant");
    if (!participant.lineUserId) {
      return badRequest("この参加者は LINE ユーザーと紐づいていないため、フェーズ移動できません（予約番号入力で紐づけてください）");
    }

    // 2. session（workId 解決）
    const session = await prisma.liveSession.findFirst({
      where:  { id: params.sessionId, oaId: params.id, origin: NATIVE_ORIGIN },
      select: { id: true, workId: true },
    });
    if (!session) return notFound("LiveSession");
    if (!session.workId) return badRequest("この公演は作品に紐づいていないため、フェーズ移動できません");
    const workId = session.workId;
    const lineUserId = participant.lineUserId;

    // 3. 移動先フェーズ（同一作品のフェーズであること）
    const phaseRow = await fetchPhaseWithIncludes(data.target_phase_id);
    if (!phaseRow) return notFound("移動先フェーズ");
    if (phaseRow.workId !== workId) {
      return badRequest("移動先フェーズがこの公演の作品に属していません");
    }
    const isEnding = phaseRow.phaseType === "ending";

    // 4. OA（token / 停止状態 / 作品名）
    const oa = await prisma.oa.findUnique({
      where:  { id: params.id },
      select: { channelAccessToken: true, title: true, serviceSuspendedAt: true },
    });
    if (!oa) return notFound("OA");
    const suspended = oa.serviceSuspendedAt != null;

    // 5. 対象プレイヤーの UserProgress（未開始なら移動不可）
    const progress = await prisma.userProgress.findUnique({
      where: { lineUserId_workId: { lineUserId, workId } },
    });
    if (!progress) return badRequest("対象プレイヤーはこの作品をまだ開始していません");
    const fromPhaseId = progress.currentPhaseId;

    // 6. 実 UserProgress を移動（+ cache 無効化）— 前例: consumeCheckinTrigger
    const updated = await prisma.userProgress.update({
      where: { id: progress.id },
      data:  { currentPhaseId: data.target_phase_id, reachedEnding: isEnding, lastInteractedAt: new Date() },
    });
    await activeCache.delete(CACHE_KEY.progress(lineUserId, workId));

    // 7. メッセージ push（send_messages かつ 非停止のとき）
    let sent = false;
    let sendSkippedReason: string | null = null;
    if (data.send_messages && suspended) {
      sendSkippedReason = "service_suspended";
    } else if (data.send_messages) {
      const work = await prisma.work.findUnique({
        where:  { id: workId },
        select: { systemCharacter: { select: { name: true, iconImageUrl: true } } },
      });
      const systemSender: LineSender | undefined = work?.systemCharacter
        ? {
            name: work.systemCharacter.name.slice(0, 20),
            ...(work.systemCharacter.iconImageUrl?.startsWith("https://")
              ? { iconUrl: work.systemCharacter.iconImageUrl }
              : {}),
          }
        : undefined;
      const vars: PlaceholderVars = {
        userName:    await fetchDisplayName(lineUserId, oa.channelAccessToken),
        accountName: oa.title,
      };
      const state = await buildRuntimeState(updated, phaseRow);
      const msgs  = buildPhaseMessages(state.phase, { systemSender, vars });
      const pushed = await pushToLine(lineUserId, msgs, oa.channelAccessToken);
      sent = pushed.ok;
      if (!pushed.ok) sendSkippedReason = `push_failed_${pushed.status ?? "unknown"}`;

      // frontier / waitingForInput / トリガー武装（webhook のフェーズ入場後と同じ後処理）
      if (pushed.ok) {
        const sentMessageIds = state.phase?.messages.map((m) => m.id) ?? [];
        await applyFreeInputPostEffect({
          sentMessageIds, userId: lineUserId, workId, progressId: updated.id, oaId: params.id,
          route: "live-staff-phase-move",
        }).catch(() => {});
      }
    }

    // 8. LiveParticipant 側も直接更新（staff 移動は webhook を経由しないため同期が走らない）
    await prisma.liveParticipant.update({
      where: { id: participant.id },
      data:  {
        currentPhaseId: data.target_phase_id,
        lastSeenAt:     new Date(),
        status:         isEnding ? "completed" : "active",
      },
    });

    // 9. 操作ログ（監査）
    await prisma.liveEventLog.create({
      data: {
        oaId:          params.id,
        liveSessionId: params.sessionId,
        participantId: participant.id,
        type:          "staff_phase_move",
        title:         "スタッフによるフェーズ移動",
        detail:        `→ ${phaseRow.name}${sent ? "（メッセージ送信）" : "（送信なし）"}`,
        payload: {
          from_phase_id: fromPhaseId,
          to_phase_id:   data.target_phase_id,
          to_phase_name: phaseRow.name,
          by_user_id:    auth.user.id,
          sent,
          send_requested: data.send_messages,
          ...(sendSkippedReason ? { send_skipped_reason: sendSkippedReason } : {}),
        },
      },
    });

    return ok({
      moved:         true,
      sent,
      participant_id: participant.id,
      from_phase_id: fromPhaseId,
      to_phase_id:   data.target_phase_id,
      to_phase_name: phaseRow.name,
      ...(sendSkippedReason ? { send_skipped_reason: sendSkippedReason } : {}),
    });
  } catch (err) {
    return serverError(err);
  }
}
