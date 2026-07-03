// src/lib/frontier-effect.ts
//
// 送信後の post-send effect: frontier(lastSentMessageIds) 更新 + 自由入力受付(waitingForInput) 設定。
// webhook の各送信パス（triggerKeyword / フェーズ遷移 / QR / puzzle 正解遷移 / start 等）の
// reply 後に呼ぶことで「現在地（直近送信した messageId 群）」を frontier に記録し、
// QR/Quick Reply の有効範囲を現在地に限定する（#243）。あわせて、送信群に freeInput プロンプトが
// あれば waitingForInput を立てる。
//
// webhook route.ts から切り出した自己完結関数（prisma / activeCache のみ依存）。
// 単体テスト可能にするため lib 化（Next.js は route.ts からの任意 export を許可しないため）。
//
// 仕様:
//   - sentMessageIds が空なら no-op。
//   - frontier(lastSentMessageIds) は常に更新。
//   - 送信群に freeInputEnabled=true の message があれば waitingForInput も更新（最も後ろの sortOrder を採用）。
//   - progressId があれば update、無ければ upsert（開始直後で progress 行未作成のケース）。

import { prisma } from "@/lib/prisma";
import { activeCache, CACHE_KEY } from "@/lib/cache";
import { armCheckinTriggers } from "@/lib/checkin-trigger";
import { armScheduledMessages } from "@/lib/scheduled-message-arm";

export async function applyFreeInputPostEffect(args: {
  sentMessageIds: string[];
  userId:         string;
  workId:         string;
  progressId?:    string;
  oaId?:          string;
  route?:         string;
}): Promise<void> {
  if (args.sentMessageIds.length === 0) return;

  // ── frontier 更新（常に実行） ──
  // 直近送信した chain の messageId 群を保存する。QR/Quick Reply の有効範囲を
  // 「現在地に紐づくものだけ」に限定し、過去 QR の再タップによる無限再送を防ぐ。
  const frontierJson = JSON.stringify(args.sentMessageIds);
  console.info("[line:progress:frontier:update]", JSON.stringify({
    oaId:         args.oaId ?? null,
    workId:       args.workId,
    userIdPrefix: args.userId.slice(0, 8),
    route:        args.route ?? null,
    messageIds:   args.sentMessageIds,
  }));

  // 自由入力受付メッセージが送信群に含まれていれば waitingForInput も立てる。
  const freeInputMsg = await prisma.message.findFirst({
    where:  { id: { in: args.sentMessageIds }, isActive: true, freeInputEnabled: true },
    orderBy: { sortOrder: "desc" },
    select: { id: true, freeInputVariableKey: true, freeInputNextMessageId: true },
  });
  // variableKey は任意 (null = ログ用途・差し込み不要)。message へ進むだけで OK。
  const waitingJson = freeInputMsg
    ? JSON.stringify({
        messageId:     freeInputMsg.id,
        variableKey:   freeInputMsg.freeInputVariableKey ?? null,
        nextMessageId: freeInputMsg.freeInputNextMessageId ?? null,
        setAt:         new Date().toISOString(),
      })
    : null;

  // ── silent auto-transition: 送信群に autoTransitionPhaseId を持つメッセージがあれば、
  //    プレイヤーの入力を待たず currentPhaseId のみ更新する（遷移先の入場メッセージは送らない＝silent）。
  //    キーワード/QR/postback 起点の遷移とは別物。ここでは phase メッセージの送信は一切行わないため、
  //    「続きを選んでください。」fallback（buildPhaseMessages）は出ない。
  //    運用はチェーン末尾に設定する想定。複数あれば sortOrder が最も後ろのものを採用。
  //    scope 安全性: 遷移先 phase が同一 work のものであることを確認（別 work/OA へは飛ばさない）。
  let autoTransition: { toPhaseId: string; reachedEnding: boolean; viaMessageId: string } | null = null;
  const autoTransMsg = await prisma.message.findFirst({
    where:   { id: { in: args.sentMessageIds }, isActive: true, autoTransitionPhaseId: { not: null } },
    orderBy: { sortOrder: "desc" },
    select:  { id: true, autoTransitionPhaseId: true },
  });
  if (autoTransMsg?.autoTransitionPhaseId) {
    const toPhase = await prisma.phase.findUnique({
      where:  { id: autoTransMsg.autoTransitionPhaseId },
      select: { id: true, workId: true, phaseType: true },
    });
    if (toPhase && toPhase.workId === args.workId) {
      autoTransition = { toPhaseId: toPhase.id, reachedEnding: toPhase.phaseType === "ending", viaMessageId: autoTransMsg.id };
    } else {
      console.warn(
        `[auto-transition] 遷移先 phase が不正/別work のためスキップ`,
        `userId=${args.userId.slice(0, 8)} toPhaseId=${autoTransMsg.autoTransitionPhaseId?.slice(0, 8)} work=${args.workId.slice(0, 8)}`,
      );
    }
  }

  // frontier は常に更新。waitingForInput は freeInput メッセージがある場合のみ更新（無ければ既存値を保持）。
  // currentPhaseId は autoTransition があるときのみ更新（silent・入場メッセージは送らない）。
  const data: { lastSentMessageIds: string; waitingForInput?: string; currentPhaseId?: string; reachedEnding?: boolean } = { lastSentMessageIds: frontierJson };
  if (waitingJson !== null) data.waitingForInput = waitingJson;
  if (autoTransition) {
    data.currentPhaseId = autoTransition.toPhaseId;
    data.reachedEnding  = autoTransition.reachedEnding;
  }

  try {
    if (args.progressId) {
      await prisma.userProgress.update({ where: { id: args.progressId }, data });
    } else {
      // 開始直後で progress 行が未作成のケース。upsert で安全に新規作成。
      await prisma.userProgress.upsert({
        where:  { lineUserId_workId: { lineUserId: args.userId, workId: args.workId } },
        create: { lineUserId: args.userId, workId: args.workId, ...data },
        update: data,
      });
    }
    await activeCache.delete(CACHE_KEY.progress(args.userId, args.workId));
    if (autoTransition) {
      console.log(
        `[auto-transition] silent 遷移`,
        `userId=${args.userId.slice(0, 8)}`,
        `toPhaseId=${autoTransition.toPhaseId.slice(0, 8)}`,
        `viaMsg=${autoTransition.viaMessageId.slice(0, 8)}`,
        `route=${args.route ?? "-"}`,
      );
    }
    if (waitingJson) {
      console.log(
        `[Webhook][free-input] waiting セット完了`,
        `userId=${args.userId.slice(0, 8)}`,
        `msgId=${freeInputMsg!.id.slice(0, 8)}`,
        `key=${freeInputMsg!.freeInputVariableKey}`,
      );
    }
  } catch (err) {
    console.error(`[Webhook][post-send] frontier/waiting 更新失敗 userId=${args.userId}`, err);
  }

  // ── 送信後の待機トリガー（地点到着で自動進行）の arm ──
  // 送信群に checkinTrigger* を持つメッセージがあれば、対象ユーザーを対象地点の検知待ちに武装する。
  // 失敗は内部で握りつぶす（送信本体を壊さない）。
  await armCheckinTriggers({
    sentMessageIds: args.sentMessageIds,
    lineUserId:     args.userId,
    workId:         args.workId,
    oaId:           args.oaId,
  });

  // ── 時間差メッセージ（予約送信）の予約作成（PR-4c-2）──
  // 送信群に scheduledMessageSettings.enabled のメッセージがあれば ScheduledLineMessage(pending) を作成。
  // ENABLE_SCHEDULED_MESSAGE_RESERVATION=true のときだけ（未設定なら no-op）。push は呼ばない。
  // 失敗は内部で握りつぶす（reply 本体を壊さない）。oaId 不明時は work から解決を armChecking と揃える。
  if (args.oaId) {
    await armScheduledMessages({
      sentMessageIds: args.sentMessageIds,
      oaId:           args.oaId,
      workId:         args.workId,
      lineUserId:     args.userId,
      userProgressId: args.progressId ?? null,
    });
  }
}
