// src/lib/broadcast/processor.ts
//
// 配信メッセージの実送信（BroadcastProcessor）。**配信専用**。
//
// 1 リクエストで全宛先を送らず chunk 単位で進める。呼び出し側（API / cron）が
// hasMore=true の間だけ再度叩く。途中でタイムアウトしても、pending の宛先が
// 残っているだけなので次の chunk から安全に再開できる。
//
// webhook / reply 経路とは一切共有しない。ここから応答メッセージの送信関数を呼ばないし、
// 応答メッセージ側からこの processor を呼ばない。共通なのは pushToLine のみ。

import { prisma } from "@/lib/prisma";
import { pushToLine } from "@/lib/line";
import { parseBroadcastContent, toLineMessages } from "./content";

/** 1 回の process 呼び出しで送る最大件数。 */
export const BROADCAST_CHUNK_SIZE = 50;

export type ProcessResult =
  | { ok: true; processed: number; sent: number; failed: number; hasMore: boolean; status: string }
  | { ok: false; reason: "not_found" | "not_sending" | "invalid_content" | "no_token" };

/** 配信結果から最終 status を決める。 */
export function finalStatusOf(successCount: number, failureCount: number): string {
  if (failureCount === 0) return "sent";
  if (successCount === 0) return "failed";
  return "partial_failed";
}

/**
 * pending の宛先を最大 BROADCAST_CHUNK_SIZE 件処理する。
 * 送信結果は宛先ごとに BroadcastRecipient へ記録する（成功/失敗の追跡と再送のため）。
 */
export async function processBroadcastChunk(args: {
  oaId: string;
  broadcastId: string;
  chunkSize?: number;
}): Promise<ProcessResult> {
  const { oaId, broadcastId } = args;
  const chunkSize = args.chunkSize ?? BROADCAST_CHUNK_SIZE;

  const broadcast = await prisma.broadcast.findFirst({
    where: { id: broadcastId, oaId },
    select: { id: true, status: true, contentJson: true, oa: { select: { channelAccessToken: true } } },
  });
  if (!broadcast) return { ok: false, reason: "not_found" };
  if (broadcast.status !== "sending") return { ok: false, reason: "not_sending" };

  const content = parseBroadcastContent(broadcast.contentJson);
  if (!content) return { ok: false, reason: "invalid_content" };

  const token = broadcast.oa.channelAccessToken;
  if (!token) return { ok: false, reason: "no_token" };

  const messages = toLineMessages(content);

  const pending = await prisma.broadcastRecipient.findMany({
    where: { broadcastId, status: "pending" },
    select: { id: true, lineUserId: true },
    orderBy: { id: "asc" },
    take: chunkSize,
  });

  let sent = 0;
  let failed = 0;

  for (const r of pending) {
    // pushToLine は例外を投げず {ok,status} を返す（ネットワークエラーも ok:false）。
    const res = await pushToLine(r.lineUserId, messages, token);

    if (res.ok) {
      sent++;
      await prisma.broadcastRecipient.update({
        where: { id: r.id },
        data: { status: "sent", httpStatus: res.status ?? 200, errorMessage: null, sentAt: new Date() },
      });
    } else {
      failed++;
      console.warn("[line:broadcast:recipient-failed]", JSON.stringify({
        broadcastId, userId: r.lineUserId.slice(0, 8), status: res.status ?? null,
      }));
      await prisma.broadcastRecipient.update({
        where: { id: r.id },
        data: {
          status: "failed",
          httpStatus: res.status ?? null,
          // 本文・PII は入れない。HTTP status だけを残す。
          errorMessage: res.status ? `LINE push failed (HTTP ${res.status})` : "LINE push failed",
        },
      });
    }
  }

  // 集計は「宛先テーブルの実状態」から取り直す。
  // chunk が並行実行されてもカウンタが二重加算されない。
  const [successCount, failureCount, remaining] = await Promise.all([
    prisma.broadcastRecipient.count({ where: { broadcastId, status: "sent" } }),
    prisma.broadcastRecipient.count({ where: { broadcastId, status: "failed" } }),
    prisma.broadcastRecipient.count({ where: { broadcastId, status: "pending" } }),
  ]);

  const hasMore = remaining > 0;
  const status = hasMore ? "sending" : finalStatusOf(successCount, failureCount);

  await prisma.broadcast.updateMany({
    where: { id: broadcastId, oaId, status: "sending" },
    data: {
      successCount,
      failureCount,
      ...(hasMore ? {} : { status, completedAt: new Date() }),
    },
  });

  console.log(hasMore ? "[line:broadcast:progress]" : "[line:broadcast:complete]", JSON.stringify({
    broadcastId, oaId, processed: pending.length, successCount, failureCount, remaining, status,
  }));

  return { ok: true, processed: pending.length, sent, failed, hasMore, status };
}
