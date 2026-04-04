// src/lib/event-logger.ts
// event_logs テーブルへの書き込みを行うサーバーサイドユーティリティ。
// fire-and-forget — await しなくてよい。エラーはコンソールのみに出力し、
// 呼び出し元の処理を絶対にブロックしない。

import { prisma } from "@/lib/prisma";
import type { EventName, EventPayloadMap } from "@/lib/constants/event-names";

interface LogOptions {
  userId?:  string | null;
  oaId?:    string | null;
}

/**
 * event_logs テーブルに1件書き込む（サーバーサイド専用）。
 * Promise を返すが、通常は await 不要（fire-and-forget）。
 */
export async function logEvent<E extends EventName>(
  eventName: E,
  payload:   EventPayloadMap[E],
  opts:      LogOptions = {},
): Promise<void> {
  try {
    await prisma.eventLog.create({
      data: {
        eventName,
        payload:  JSON.stringify(payload),
        userId:   opts.userId ?? null,
        oaId:     opts.oaId  ?? null,
      },
    });
  } catch (err) {
    // ログ失敗はサイレント（本来の処理をブロックしない）
    console.error("[logEvent] failed to write event_log:", eventName, err);
  }
}
