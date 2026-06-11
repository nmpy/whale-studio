// src/__tests__/chain-per-message-timing.test.ts
//
// チェーン送信で「各メッセージごとに」入力中/待機(演出)が反映されることの回帰テスト。
// 不具合: replyWithLagToLine が ≤5 件を 1 回の Reply にまとめていたため、2 通目以降の
//        typing/loading/lag が無視されていた（1 通目だけ効く）。
// 修正: 2 通目以降に演出があれば head のみ Reply・残りを Push で 1 件ずつ送り、
//        各送信前に lag(待機) と typing/loading を反映する。
//
// 検証ケース:
//  1. 単発メッセージの lag_ms（head 送信前待機 = resolveHeadSendDelayMs）
//  2. チェーン 1 通目の lag_ms（head・同上）
//  3. チェーン 2 通目の lag_ms が送信前に await される
//  4. チェーン 3 通目以降の lag_ms も送信前に await される
//  5. 2 通目以降の typing/loading が送信前に呼ばれる（controller）
//  6. Flex / 画像 / text で _lagMs / _timing メタが落ちない（convertMessageToLine）

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  replyWithLagToLine, resolveHeadSendDelayMs, buildKeywordMessages,
  type LineMessage, type KeywordMessageRecord,
} from "@/lib/line";
import type { MessageTimingConfig } from "@/types";

const REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const PUSH_URL  = "https://api.line.me/v2/bot/message/push";

type Call = { url: string; count: number };
let calls: Call[] = [];
let origFetch: typeof global.fetch;

function setupFetch() {
  global.fetch = vi.fn(async (url: unknown, init: unknown) => {
    const u = String(url);
    const body = JSON.parse((init as { body: string }).body);
    calls.push({ url: u, count: Array.isArray(body.messages) ? body.messages.length : 0 });
    return { ok: true, status: 200, text: async () => "" } as unknown as Response;
  }) as unknown as typeof global.fetch;
}
const replies = () => calls.filter((c) => c.url === REPLY_URL);
const pushes  = () => calls.filter((c) => c.url === PUSH_URL);

function timing(over: Partial<MessageTimingConfig> = {}): MessageTimingConfig {
  return {
    read_receipt_mode: "immediate", read_delay_ms: null,
    typing_enabled: true, typing_min_ms: 5000, typing_max_ms: 5000,
    loading_enabled: true, loading_threshold_ms: 0, loading_min_seconds: 5, loading_max_seconds: 5,
    ...over,
  } as MessageTimingConfig;
}

/** _lagMs / _timing 付きの text メッセージ列を作る（先頭=head は lag なし）。 */
function chain(lags: (number | undefined)[]): LineMessage[] {
  return lags.map((lag, i) => ({
    type: "text", text: `m${i + 1}`, _sourceMessageId: `id${i + 1}`,
    ...(lag != null ? { _lagMs: lag } : {}),
  }) as LineMessage);
}

beforeEach(() => {
  calls = [];
  origFetch = global.fetch;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = origFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── ケース 1 / 2: head（単発・チェーン1通目）の lag は resolveHeadSendDelayMs で解決 ──
describe("head（単発・1通目）の lag_ms 解決", () => {
  it("1. 単発: _lagMs=5000 → resolveHeadSendDelayMs=5000（送信前待機の値）", () => {
    expect(resolveHeadSendDelayMs({ _lagMs: 5000 })).toBe(5000);
  });
  it("2. チェーン1通目: head の _lagMs を解決（lag なし=0）", () => {
    expect(resolveHeadSendDelayMs({ _lagMs: 3000 })).toBe(3000);
    expect(resolveHeadSendDelayMs({})).toBe(0);
    expect(resolveHeadSendDelayMs(null)).toBe(0);
  });
});

// ── ケース 3 / 4: 2通目・3通目以降の lag が「送信前に」await される ──
describe("チェーン 2 通目以降の lag_ms が送信前に await される", () => {
  it("3 & 4. 2通目(5000ms)・3通目(3000ms) は各 lag 経過後にのみ Push される", async () => {
    vi.useFakeTimers();
    setupFetch();
    const p = replyWithLagToLine("rt", chain([undefined, 5000, 3000]), "U1", "tok");

    // head のみ Reply 済み・push はまだ（2通目の lag 待機中）
    await vi.advanceTimersByTimeAsync(0);
    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(1);
    expect(pushes()).toHaveLength(0);

    // 2通目: 5000ms 経過後に Push される（4999ms ではまだ）
    await vi.advanceTimersByTimeAsync(4999);
    expect(pushes()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(pushes()).toHaveLength(1);

    // 3通目: さらに 3000ms 経過後に Push される
    await vi.advanceTimersByTimeAsync(2999);
    expect(pushes()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pushes()).toHaveLength(2);

    await p;
    expect(pushes().every((c) => c.count === 1)).toBe(true); // 各 1 件ずつ個別送信
  });
});

// ── ケース 5: 2通目以降の typing / loading が送信前に呼ばれる ──
describe("チェーン 2 通目以降の typing / loading が controller 経由で呼ばれる", () => {
  it("5. _timing 付き 2通目・3通目で waitTypingForMessage / showLoadingForMessage が各 1 回呼ばれる", async () => {
    vi.useFakeTimers();
    setupFetch();
    const controller = {
      abortPendingLoading:   vi.fn(),
      waitTypingForMessage:  vi.fn().mockResolvedValue(undefined),
      showLoadingForMessage: vi.fn().mockResolvedValue(undefined),
    };
    const msgs: LineMessage[] = [
      { type: "text", text: "head", _sourceMessageId: "h" } as LineMessage,
      { type: "text", text: "m2", _sourceMessageId: "id2", _lagMs: 10, _timing: timing() } as LineMessage,
      { type: "text", text: "m3", _sourceMessageId: "id3", _lagMs: 10, _timing: timing() } as LineMessage,
    ];
    const p = replyWithLagToLine("rt", msgs, "U1", "tok", controller as never);
    await vi.runAllTimersAsync();
    await p;

    expect(controller.abortPendingLoading).toHaveBeenCalledTimes(1);
    expect(controller.waitTypingForMessage).toHaveBeenCalledTimes(2);  // 2通目・3通目
    expect(controller.showLoadingForMessage).toHaveBeenCalledTimes(2);
    // head(1通目) は controller の per-message ループ対象外（wrapper が別途処理）
    expect(pushes()).toHaveLength(2);
  });
});

// ── ケース 6: Flex / 画像 / text で _lagMs / _timing メタが落ちない ──
describe("convertMessageToLine: 全メッセージ型で _lagMs / _timing が保持される", () => {
  function rec(over: Partial<KeywordMessageRecord> & { id: string; messageType: string }): KeywordMessageRecord {
    return {
      body: null, assetUrl: null, altText: null, flexPayloadJson: null, quickReplies: null,
      nextMessageId: null, sortOrder: 0, character: null, ...over,
    } as KeywordMessageRecord;
  }
  it("6. text / image / flex すべてに _lagMs と _timing が付与される", () => {
    const t = timing();
    const out = buildKeywordMessages([
      rec({ id: "t", messageType: "text", body: "hello", lagMs: 2000, timing: t }),
      rec({ id: "i", messageType: "image", assetUrl: "https://example.com/a.png", lagMs: 3000, timing: t }),
      rec({ id: "f", messageType: "flex", altText: "flex alt",
            flexPayloadJson: JSON.stringify({ type: "bubble", body: { type: "box", layout: "vertical", contents: [] } }),
            lagMs: 4000, timing: t }),
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]._lagMs).toBe(2000); expect(out[0]._timing).toEqual(t);
    expect(out[1]._lagMs).toBe(3000); expect(out[1]._timing).toEqual(t);
    expect(out[2]._lagMs).toBe(4000); expect(out[2]._timing).toEqual(t);
  });
});
