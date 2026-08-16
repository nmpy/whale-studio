// src/app/oas/[id]/broadcasts/_client.ts
//
// 配信メッセージ画面の API クライアント。**配信専用**。
// 既存「応答メッセージ」の API / クライアントは呼ばない。

import { getAuthHeaders } from "@/lib/api-client";

export type BroadcastStatus = "draft" | "sending" | "sent" | "partial_failed" | "failed" | "cancelled";

export interface BroadcastDto {
  id: string;
  oa_id: string;
  name: string;
  status: BroadcastStatus;
  target_type: "all" | "segment";
  segment_id: string | null;
  segment_work_id: string | null;
  content: { kind: "text"; text: string };
  recipient_count: number;
  success_count: number;
  failure_count: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BroadcastDetailDto extends BroadcastDto {
  pending_count: number;
  /** LINE が受理したか確定できず、自動再送を止めた宛先の件数（要確認）。 */
  skipped_count: number;
  /** 再送してよい失敗（timeout / 5xx かつ 24h 以内）。再送ボタンの活性はこれで判断する。 */
  retryable_failure_count: number;
  /** 4xx など再送しても結果が変わらない失敗。 */
  non_retryable_failure_count: number;
  failed_samples: { line_user_id_prefix: string; http_status: number | null; error_message: string | null }[];
}

/** 対象指定。lineUserId をクライアントから送る API は存在しない（宛先はサーバーが解決する）。 */
export type TargetInput =
  | { target_type: "all" }
  | { target_type: "segment"; segment_id: string; work_id: string };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...getAuthHeaders(), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.error?.message ?? `リクエストに失敗しました (HTTP ${res.status})`);
  }
  return json.data as T;
}

export const broadcastApi = {
  list: (oaId: string) => call<BroadcastDto[]>(`/api/oas/${oaId}/broadcasts`),

  get: (oaId: string, id: string) => call<BroadcastDetailDto>(`/api/oas/${oaId}/broadcasts/${id}`),

  create: (oaId: string, body: { name: string; content: { kind: "text"; text: string } } & TargetInput) =>
    call<BroadcastDto>(`/api/oas/${oaId}/broadcasts`, { method: "POST", body: JSON.stringify(body) }),

  /** 配信予定人数。件数だけが返る（宛先は返らない）。 */
  audienceCount: (oaId: string, target: TargetInput) =>
    call<{ count: number }>(`/api/oas/${oaId}/broadcasts/audience`, {
      method: "POST", body: JSON.stringify(target),
    }),

  /** テスト送信。配信実績（recipient / count）には一切残らない。 */
  testSend: (oaId: string, body: { line_user_id: string; content: { kind: "text"; text: string } }) =>
    call<{ sent: boolean; http_status: number | null }>(`/api/oas/${oaId}/broadcasts/test-send`, {
      method: "POST", body: JSON.stringify(body),
    }),

  start: (oaId: string, id: string) =>
    call<{ started: boolean; recipient_count: number }>(`/api/oas/${oaId}/broadcasts/${id}/start`, { method: "POST" }),

  /** chunk を 1 回進める。has_more が false になるまで呼ぶ。 */
  process: (oaId: string, id: string) =>
    call<{ processed: number; sent: number; failed: number; has_more: boolean; status: BroadcastStatus }>(
      `/api/oas/${oaId}/broadcasts/${id}/process`, { method: "POST" },
    ),

  retry: (oaId: string, id: string) =>
    call<{ requeued: number; skipped?: number; nonRetryable?: number }>(`/api/oas/${oaId}/broadcasts/${id}/retry`, { method: "POST" }),
};

export const BROADCAST_STATUS_LABEL: Record<BroadcastStatus, string> = {
  draft:          "下書き",
  sending:        "送信中",
  sent:           "送信完了",
  partial_failed: "一部失敗",
  failed:         "失敗",
  cancelled:      "取消",
};
