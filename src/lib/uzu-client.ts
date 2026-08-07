// src/lib/uzu-client.ts
//
// UZU Pro CMS の連携受信エンドポイントへの送信クライアント。
//
// 送信先: POST {UZU_BASE_URL}/api/integrations/whale-studio/events
// 認証:   Authorization: Bearer {UZU_EVENTS_SECRET}（UZU 側 WHALE_STUDIO_EVENTS_SECRET と同値）
//
// 応答の分類（Step 1 確定仕様）:
//   network error / timeout / 5xx / 429  → retryable（バックオフして再送）
//   400（payload 不正）                   → terminal
//   401 / 403                             → terminal（設定不備。運用側で気づけるようコードを分ける）
//   2xx                                   → sent
//
// 重要: UZU が 200 を返しつつ内部で BOOKING_NOT_IMPORTED として保留する場合、
//       **配送は成功**である。Whale 側 outbox は sent とし、再送しない
//       （UZU 側で ESCAPE.ID 取込を契機に自動 reconciliation される）。
//
// 秘密値（Bearer トークン）・LINE UID はログへ出さない。

export const UZU_EVENTS_PATH = "/api/integrations/whale-studio/events";

export type SendOutcome =
  | { ok: true; httpStatus: number }
  | { ok: false; retryable: boolean; errorCode: string; message: string };

export type UzuEnvelope = {
  schemaVersion: 1;
  eventId: string;
  eventType: string;
  source: "whale_studio";
  occurredAt: string;
  projectId: string;
  payload: Record<string, unknown>;
};

/** 保存済み outbox 行から envelope を組み立てる（eventId = 行 id ＝再送しても不変）。 */
export function buildEnvelope(row: {
  id: string;
  eventType: string;
  uzuProjectId: string;
  payloadJson: unknown;
  createdAt?: Date;
}): UzuEnvelope {
  return {
    schemaVersion: 1,
    eventId:       row.id,
    eventType:     row.eventType,
    source:        "whale_studio",
    occurredAt:    (row.createdAt ?? new Date()).toISOString(),
    projectId:     row.uzuProjectId,
    payload:       (row.payloadJson ?? {}) as Record<string, unknown>,
  };
}

/** HTTP ステータス → 再送可否の分類。 */
export function classifyHttpStatus(status: number): { retryable: boolean; errorCode: string } {
  if (status >= 200 && status < 300) return { retryable: false, errorCode: "OK" };
  if (status === 429) return { retryable: true, errorCode: "RATE_LIMITED" };
  if (status >= 500) return { retryable: true, errorCode: `HTTP_${status}` };
  if (status === 401) return { retryable: false, errorCode: "UNAUTHORIZED" };
  if (status === 403) return { retryable: false, errorCode: "FORBIDDEN" };
  if (status === 400) return { retryable: false, errorCode: "INVALID_PAYLOAD" };
  // その他 4xx は設定・実装の問題として terminal 扱い（無限再送を作らない）。
  return { retryable: false, errorCode: `HTTP_${status}` };
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** 送信の実処理。テストから fetcher を差し替えられるようにする。 */
export async function sendEnvelope(
  envelope: UzuEnvelope,
  opts: { baseUrl: string; secret: string; timeoutMs?: number; fetcher?: Fetcher },
): Promise<SendOutcome> {
  const url = new URL(UZU_EVENTS_PATH, opts.baseUrl).toString();
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const doFetch = opts.fetcher ?? ((u, i) => fetch(u, i));

  try {
    const res = await doFetch(url, {
      method:  "POST",
      headers: {
        "content-type":  "application/json",
        authorization:   `Bearer ${opts.secret}`,
      },
      body:   JSON.stringify(envelope),
      signal: controller.signal,
    });
    const cls = classifyHttpStatus(res.status);
    if (res.status >= 200 && res.status < 300) return { ok: true, httpStatus: res.status };
    return { ok: false, retryable: cls.retryable, errorCode: cls.errorCode, message: `http ${res.status}` };
  } catch (e) {
    // abort / network error はいずれも一時障害として再送対象。
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      ok:        false,
      retryable: true,
      errorCode: aborted ? "TIMEOUT" : "NETWORK_ERROR",
      message:   aborted ? `timeout ${timeoutMs}ms` : "network error",
    };
  } finally {
    clearTimeout(timer);
  }
}
