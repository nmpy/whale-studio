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

  // frontier は常に更新。waitingForInput は freeInput メッセージがある場合のみ更新（無ければ既存値を保持）。
  const data: { lastSentMessageIds: string; waitingForInput?: string } = { lastSentMessageIds: frontierJson };
  if (waitingJson !== null) data.waitingForInput = waitingJson;

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
}
