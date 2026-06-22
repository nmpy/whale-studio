// src/lib/scheduled-message-sender.ts
//
// 時間差メッセージ（予約送信）の real LINE **push** sender（PR-4b）。
//   - reply ではなく **push API**（https://api.line.me/v2/bot/message/push）を呼ぶ＝月間メッセージ通数を消費する。
//   - channelAccessToken は **サーバ側でのみ**使用し、レスポンス・ログ・戻り値に出さない（PII/token 非出力）。
//   - payloadJson（{message_type, body, asset_url, character_id}）から LINE message object を復元して送る。
//   - 二重送信抑止に **X-Line-Retry-Key**（reservation の id = UUID）を付与。成功時は x-line-request-id を保存。
//
// この sender は worker（scheduled-message-worker）に注入される。push 関数・token/character 解決はすべて
// 注入可能でテスト容易。本番配線（prisma）は createScheduledPushSender で行う。

import type { LineMessage, LineSender } from "@/lib/line";
import type { ScheduledMessagePayload } from "@/lib/scheduled-message";
import type { ScheduledSender } from "@/lib/scheduled-message-worker";

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

/** 失敗分類（純関数）。HTTP status から「再試行可否」と安全な分類名を返す。 */
export function classifyPushFailure(status?: number): { kind: string; retryable: boolean } {
  if (status === undefined)              return { kind: "network_error",        retryable: true  }; // ネットワーク/タイムアウト
  if (status === 429)                    return { kind: "quota_or_rate_limited", retryable: false }; // 月間上限超過想定 → 非retry（PR-4c: messageでrate/quota分離）
  if (status === 400)                    return { kind: "invalid_request",       retryable: false }; // payload不正/不正userId
  if (status === 403)                    return { kind: "blocked_or_forbidden",  retryable: false }; // blocked/token不正
  if (status === 404)                    return { kind: "invalid_user",          retryable: false };
  if (status >= 500 && status <= 599)    return { kind: "line_5xx",              retryable: true  }; // LINEサーバ起因 → retry
  return { kind: `http_${status}`, retryable: false }; // その他4xx → 非retry
}

/** payload から LINE message object を構築（純関数）。不正/空なら [] を返す（呼び出し側は invalid_payload 扱い）。 */
export function buildLineMessagesFromPayload(payload: ScheduledMessagePayload, sender?: LineSender): LineMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const type = payload.message_type;
  if (type === "image") {
    const url = (payload.asset_url ?? "").trim();
    if (!url.startsWith("https://")) return []; // 画像URLが無い/非httpsは送れない
    return [{ type: "image", originalContentUrl: url, previewImageUrl: url, ...(sender ? { sender } : {}) }];
  }
  // 既定: text。
  const text = (payload.body ?? "").trim();
  if (!text) return [];
  return [{ type: "text", text, ...(sender ? { sender } : {}) }];
}

/** push API 呼び出し結果。token は含めない。 */
export interface ScheduledPushResult { ok: boolean; status?: number; requestId?: string | null; }

/**
 * LINE push API を直接呼ぶ（pushToLine と同じ Bearer 認証・PII-safe ログ方針）。
 *   - X-Line-Retry-Key（retryKey）で LINE 側の冪等性を担保（同一予約の再試行で二重送信しにくくする）。
 *   - 成功/失敗とも **token・本文・userId はログに出さない**（status と LINE error message のみ）。
 *   - 成功時は応答ヘッダ x-line-request-id を requestId として返す。
 */
export async function pushScheduledMessage(args: {
  lineUserId:         string;
  messages:           LineMessage[];
  channelAccessToken: string;
  retryKey:           string;
}): Promise<ScheduledPushResult> {
  try {
    const res = await fetch(LINE_PUSH_URL, {
      method:  "POST",
      headers: {
        "Content-Type":   "application/json",
        Authorization:    `Bearer ${args.channelAccessToken}`,
        "X-Line-Retry-Key": args.retryKey,
      },
      body: JSON.stringify({ to: args.lineUserId, messages: args.messages }),
    });
    const requestId = res.headers.get("x-line-request-id");
    if (res.ok) return { ok: true, status: res.status, requestId };

    // 失敗: LINE の error message のみ拾う（token/本文/userId は出さない）。
    const body = await res.text().catch(() => "");
    let lineMessage: string | null = null;
    try { lineMessage = (JSON.parse(body) as { message?: string })?.message ?? null; } catch { /* 非JSON */ }
    console.error("[scheduled-push:failed]", JSON.stringify({ status: res.status, lineMessage }));
    return { ok: false, status: res.status, requestId };
  } catch (err) {
    console.error("[scheduled-push:failed]", JSON.stringify({ error: err instanceof Error ? err.message : "network" }));
    return { ok: false };
  }
}

/**
 * 本番 sender を組み立てる。token / character の解決と push 関数を注入。
 *   - token 解決失敗 → failed（token_not_found・非retry）。
 *   - payload 不正/空 → failed（invalid_payload・非retry）。
 *   - push 成功 → sent（requestId 保存）。
 *   - push 失敗 → classifyPushFailure で retry/failed を決める。
 * token は戻り値・ログに一切含めない。
 */
export function createScheduledPushSender(deps: {
  resolveChannelToken: (oaId: string) => Promise<string | null>;
  resolveSender:       (characterId: string) => Promise<LineSender | null>;
  push?:               typeof pushScheduledMessage;
}): ScheduledSender {
  const push = deps.push ?? pushScheduledMessage;
  return async (row) => {
    const token = await deps.resolveChannelToken(row.oaId);
    if (!token) return { sent: false, error: "token_not_found", retryable: false };

    let payload: ScheduledMessagePayload;
    try { payload = JSON.parse(row.payloadJson) as ScheduledMessagePayload; }
    catch { return { sent: false, error: "invalid_payload", retryable: false }; }

    let sender: LineSender | undefined;
    if (payload?.character_id) {
      const s = await deps.resolveSender(payload.character_id);
      if (s) sender = s;
    }
    const messages = buildLineMessagesFromPayload(payload, sender);
    if (messages.length === 0) return { sent: false, error: "invalid_payload", retryable: false };

    const res = await push({ lineUserId: row.lineUserId, messages, channelAccessToken: token, retryKey: row.id });
    if (res.ok) return { sent: true, requestId: res.requestId ?? null, status: res.status };

    const cls = classifyPushFailure(res.status);
    return { sent: false, status: res.status, error: cls.kind, retryable: cls.retryable };
  };
}
