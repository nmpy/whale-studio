/**
 * src/__tests__/scheduled-message-sender.test.ts
 * 時間差メッセージ real LINE push sender（PR-4b）: 失敗分類・payload→message 復元・token 安全性。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  classifyPushFailure, buildLineMessagesFromPayload, pushScheduledMessage, createScheduledPushSender,
} from "@/lib/scheduled-message-sender";
import type { PendingScheduledRow } from "@/lib/scheduled-message-worker";

const TOKEN = "super-secret-channel-token";

const row = (over: Partial<PendingScheduledRow> = {}): PendingScheduledRow => ({
  id: "res-uuid-1", workId: "w1", lineUserId: "U1", userProgressId: null, phaseId: null,
  cancelPolicyJson: null, oaId: "oa1", retryCount: 0,
  payloadJson: JSON.stringify({ message_type: "text", body: "本文だよ" }),
  ...over,
});

describe("classifyPushFailure — 失敗分類", () => {
  it("network(undefined) / 5xx は retryable", () => {
    expect(classifyPushFailure(undefined)).toMatchObject({ retryable: true, kind: "network_error" });
    expect(classifyPushFailure(500)).toMatchObject({ retryable: true });
    expect(classifyPushFailure(503)).toMatchObject({ retryable: true, kind: "line_5xx" });
  });
  it("429(quota/rate) / 400 / 403 / 404 / その他4xx は非retry", () => {
    expect(classifyPushFailure(429)).toMatchObject({ retryable: false, kind: "quota_or_rate_limited" });
    expect(classifyPushFailure(400)).toMatchObject({ retryable: false, kind: "invalid_request" });
    expect(classifyPushFailure(403)).toMatchObject({ retryable: false, kind: "blocked_or_forbidden" });
    expect(classifyPushFailure(404)).toMatchObject({ retryable: false, kind: "invalid_user" });
    expect(classifyPushFailure(422)).toMatchObject({ retryable: false });
  });
});

describe("buildLineMessagesFromPayload — payload→LINE message", () => {
  it("text → text message", () => {
    expect(buildLineMessagesFromPayload({ message_type: "text", body: "やあ" })).toEqual([{ type: "text", text: "やあ" }]);
  });
  it("image(https) → image message", () => {
    const m = buildLineMessagesFromPayload({ message_type: "image", asset_url: "https://x/y.png" });
    expect(m).toEqual([{ type: "image", originalContentUrl: "https://x/y.png", previewImageUrl: "https://x/y.png" }]);
  });
  it("image で url 無し/非https → [] / 空 body → []", () => {
    expect(buildLineMessagesFromPayload({ message_type: "image", asset_url: "" })).toEqual([]);
    expect(buildLineMessagesFromPayload({ message_type: "image", asset_url: "http://insecure" })).toEqual([]);
    expect(buildLineMessagesFromPayload({ message_type: "text", body: "  " })).toEqual([]);
  });
  it("sender(character) が付与される", () => {
    const m = buildLineMessagesFromPayload({ message_type: "text", body: "x" }, { name: "妖精", iconUrl: "https://x/i.png" });
    expect(m[0]).toMatchObject({ sender: { name: "妖精", iconUrl: "https://x/i.png" } });
  });
});

describe("createScheduledPushSender — 本番 sender の振る舞い（token 安全）", () => {
  const okPush = vi.fn(async () => ({ ok: true, status: 200, requestId: "line-req-1" }));
  const resolveSender = async () => null;

  it("token 解決失敗 → failed(token_not_found・非retry)・push を呼ばない", async () => {
    const push = vi.fn();
    const sender = createScheduledPushSender({ resolveChannelToken: async () => null, resolveSender, push });
    const r = await sender(row());
    expect(r).toMatchObject({ sent: false, error: "token_not_found", retryable: false });
    expect(push).not.toHaveBeenCalled();
  });

  it("payload 不正 → failed(invalid_payload・非retry)", async () => {
    const sender = createScheduledPushSender({ resolveChannelToken: async () => TOKEN, resolveSender, push: okPush });
    expect(await sender(row({ payloadJson: "{壊れ" }))).toMatchObject({ sent: false, error: "invalid_payload", retryable: false });
    expect(await sender(row({ payloadJson: JSON.stringify({ message_type: "text", body: "" }) }))).toMatchObject({ sent: false, error: "invalid_payload" });
  });

  it("push 成功 → sent・requestId 保存・push に token が渡る・戻り値に token を含めない", async () => {
    const push = vi.fn(async () => ({ ok: true, status: 200, requestId: "line-req-7" }));
    const sender = createScheduledPushSender({ resolveChannelToken: async () => TOKEN, resolveSender, push });
    const r = await sender(row());
    expect(r).toMatchObject({ sent: true, requestId: "line-req-7" });
    // push（サーバ側）には token が渡る
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ channelAccessToken: TOKEN, retryKey: "res-uuid-1" }));
    // 戻り値に token を含めない
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it("push 429 → 非retry failed / push 5xx → retryable", async () => {
    const s429 = createScheduledPushSender({ resolveChannelToken: async () => TOKEN, resolveSender, push: async () => ({ ok: false, status: 429 }) });
    expect(await s429(row())).toMatchObject({ sent: false, error: "quota_or_rate_limited", retryable: false });
    const s5xx = createScheduledPushSender({ resolveChannelToken: async () => TOKEN, resolveSender, push: async () => ({ ok: false, status: 503 }) });
    expect(await s5xx(row())).toMatchObject({ sent: false, error: "line_5xx", retryable: true });
  });
});

describe("pushScheduledMessage — push API 呼び出し（fetch）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("push endpoint へ Authorization: Bearer token と X-Line-Retry-Key を付けて POST・requestId を返す・token を返さない", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === "x-line-request-id" ? "req-xyz" : null) },
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);

    const res = await pushScheduledMessage({
      lineUserId: "U1", messages: [{ type: "text", text: "hi" }], channelAccessToken: TOKEN, retryKey: "rk-1",
    });
    expect(res).toEqual({ ok: true, status: 200, requestId: "req-xyz" });
    expect(JSON.stringify(res)).not.toContain(TOKEN);

    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.line.me/v2/bot/message/push");
    expect(opts.method).toBe("POST");
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers["X-Line-Retry-Key"]).toBe("rk-1");
  });

  it("失敗時は ok:false と status を返す（token は返さない）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 429, text: async () => JSON.stringify({ message: "monthly limit" }),
      headers: { get: () => null },
    } as unknown as Response)));
    const res = await pushScheduledMessage({ lineUserId: "U1", messages: [{ type: "text", text: "x" }], channelAccessToken: TOKEN, retryKey: "rk" });
    expect(res).toMatchObject({ ok: false, status: 429 });
    expect(JSON.stringify(res)).not.toContain(TOKEN);
  });
});
