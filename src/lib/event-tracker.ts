// src/lib/event-tracker.ts
// event_logs への書き込みをブラウザから行うクライアント utility。
// fire-and-forget — await 不要。エラーは握りつぶす。
// パフォーマンスを阻害しないよう fetch は非同期で投げる。

import type { EventName, EventPayloadMap } from "@/lib/constants/event-names";

interface TrackOptions {
  /** Authorization ヘッダー用トークン（dev-token など） */
  token?:  string;
  /** OA ID（コンテキストがある場合） */
  oa_id?:  string | null;
}

/**
 * イベントを非同期で記録する。
 * await 不要。エラーは無視される。
 *
 * @example
 * trackEvent("screen_view",   { page: "/pricing" },           { token, oa_id: oaId });
 * trackEvent("action_success",{ action: "work_created" },     { token, oa_id: oaId });
 * trackEvent("error",         { message: err.message, context: "work_create" }, { token });
 */
export function trackEvent<E extends EventName>(
  eventName: E,
  payload:   EventPayloadMap[E],
  opts:      TrackOptions = {},
): void {
  fetch("/api/event-logs", {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: JSON.stringify({
      event_name: eventName,
      payload,
      oa_id: opts.oa_id ?? undefined,
    }),
  }).catch(() => {});
}
