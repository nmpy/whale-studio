// src/__tests__/reply-batch-strategy.test.ts
//
// replyWithLagToLine の送信戦略を検証する。
//   - 5件以内かつ2件目以降に演出なし: Reply API 1回で全件送信（Push消費なし）
//   - 2件目以降に演出あり: 1件目Reply + 2件目以降Pushで順番送信
//   - 6件以上かつ演出なし: 先頭5件Reply + 6件目以降Push
//
// 背景:
//   Reply API は複数件まとめて送れるが、まとめ送信では message 間の
//   lag / typing / loading 演出が付かない。
//   ただしPush APIはLINE公式アカウントの月間メッセージ通数を消費するため、
//   演出が必要な場合のみPush化する。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { replyWithLagToLine, type LineMessage } from "@/lib/line";

const REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const PUSH_URL  = "https://api.line.me/v2/bot/message/push";

function texts(n: number, lagMs?: number): LineMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    type: "text",
    text: `m${i + 1}`,
    _sourceMessageId: `id${i + 1}`,
    ...(lagMs != null ? { _lagMs: lagMs } : {}),
  }) as LineMessage);
}

function textsWithSecondLag(n: number): LineMessage[] {
  return texts(n).map((m, i) => (i >= 1 ? { ...m, _lagMs: 1 } : m)) as LineMessage[];
}

function textsWithSecondLoading(n: number): LineMessage[] {
  return texts(n).map((m, i) => (
    i >= 1
      ? { ...m, _timing: { loading_enabled: true, loading_min_seconds: 5, loading_max_seconds: 5 } }
      : m
  )) as LineMessage[];
}

type FetchCall = { url: string; count: number };
let fetchCalls: FetchCall[] = [];
let origFetch: typeof global.fetch;
let infoSpy: ReturnType<typeof vi.spyOn>;

function setupFetch(pushStatus = 200) {
  global.fetch = vi.fn(async (url: unknown, init: unknown) => {
    const u = String(url);
    const body = JSON.parse((init as { body: string }).body);
    fetchCalls.push({ url: u, count: Array.isArray(body.messages) ? body.messages.length : 0 });

    const isPush = u === PUSH_URL;
    const ok = isPush ? pushStatus < 400 : true;

    return {
      ok,
      status: isPush ? pushStatus : 200,
      text: async () => (isPush && !ok ? JSON.stringify({ message: "You have reached your monthly limit." }) : ""),
    } as unknown as Response;
  }) as unknown as typeof global.fetch;
}

/** 直近の [line:reply-lag:summary] ログ JSON を取り出す。 */
function summary(): Record<string, unknown> | null {
  const call = [...infoSpy.mock.calls].reverse().find((c) => c[0] === "[line:reply-lag:summary]");
  return call ? JSON.parse(call[1] as string) : null;
}

const replies = () => fetchCalls.filter((c) => c.url === REPLY_URL);
const pushes  = () => fetchCalls.filter((c) => c.url === PUSH_URL);

beforeEach(() => {
  fetchCalls = [];
  origFetch = global.fetch;
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = origFetch;
  vi.restoreAllMocks();
});

describe("replyWithLagToLine 送信戦略", () => {
  it("1通: Reply API 1回で送る / Push を呼ばない", async () => {
    setupFetch();
    await replyWithLagToLine("rt", texts(1), "U1", "tok");

    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(1);
    expect(pushes()).toHaveLength(0);
    expect(summary()).toMatchObject({
      strategy: "reply_one",
      reason: "no_timing_effect",
      replyTotal: 1,
      pushTotal: 0,
      pushOk: 0,
      pushFail: 0,
    });
  });

  it("3通・演出なし: Reply API 1回で3件送る / Push を呼ばない", async () => {
    setupFetch();
    await replyWithLagToLine("rt", texts(3), "U1", "tok");

    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(3);
    expect(pushes()).toHaveLength(0);
    expect(summary()).toMatchObject({
      strategy: "reply_all",
      reason: "no_timing_effect",
      replyTotal: 3,
      pushTotal: 0,
      pushFail: 0,
    });
  });

  it("5通・演出なし: 境界でもReply一括 / Push を呼ばない", async () => {
    setupFetch();
    await replyWithLagToLine("rt", texts(5), "U1", "tok");

    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(5);
    expect(pushes()).toHaveLength(0);
    expect(summary()).toMatchObject({
      strategy: "reply_all",
      reason: "no_timing_effect",
      replyTotal: 5,
      pushTotal: 0,
    });
  });

  it("3通・2通目以降にlag演出あり: 1通目Reply + 2通目以降Push", async () => {
    setupFetch();
    await replyWithLagToLine("rt", textsWithSecondLag(3), "U1", "tok");

    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(1);
    expect(pushes()).toHaveLength(2);
    expect(pushes().map((p) => p.count)).toEqual([1, 1]);
    expect(summary()).toMatchObject({
      strategy: "reply_first_push_rest",
      reason: "preserve_message_order_and_timing",
      replyTotal: 1,
      pushTotal: 2,
      pushOk: 2,
      pushFail: 0,
    });
  });

  it("5通・2通目以降にloading演出あり: 1通目Reply + 4件Push", async () => {
    setupFetch();
    await replyWithLagToLine("rt", textsWithSecondLoading(5), "U1", "tok");

    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(1);
    expect(pushes()).toHaveLength(4);
    expect(summary()).toMatchObject({
      strategy: "reply_first_push_rest",
      reason: "preserve_message_order_and_timing",
      replyTotal: 1,
      pushTotal: 4,
      pushOk: 4,
      pushFail: 0,
    });
  });

  it("6通・演出なし: 先頭5件Reply + 6件目以降Push", async () => {
    setupFetch();
    await replyWithLagToLine("rt", texts(6), "U1", "tok");

    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(5);
    expect(pushes()).toHaveLength(1);
    expect(pushes()[0].count).toBe(1);
    expect(summary()).toMatchObject({
      strategy: "reply_first_5_push_rest",
      reason: "line_reply_limit_5",
      replyTotal: 5,
      pushTotal: 1,
      pushOk: 1,
      pushFail: 0,
    });
  });

  it("6通・2通目以降に演出あり: 1通目Reply + 残りPushに切り替える", async () => {
    setupFetch();
    await replyWithLagToLine("rt", textsWithSecondLag(6), "U1", "tok");

    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(1);
    expect(pushes()).toHaveLength(5);
    expect(pushes().every((p) => p.count === 1)).toBe(true);
    expect(summary()).toMatchObject({
      strategy: "reply_first_push_rest",
      reason: "preserve_message_order_and_timing",
      replyTotal: 1,
      pushTotal: 5,
      pushOk: 5,
      pushFail: 0,
    });
  });

  it("Push月間上限超過(429)時、2通目以降の失敗をsummaryに記録する", async () => {
    setupFetch(429);
    await replyWithLagToLine("rt", textsWithSecondLag(3), "U1", "tok");

    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(1);
    expect(pushes()).toHaveLength(2);

    const s = summary();
    expect(s).toMatchObject({
      strategy: "reply_first_push_rest",
      replyTotal: 1,
      pushTotal: 2,
      pushOk: 0,
      pushFail: 2,
    });
    expect((s?.failures as unknown[])).toHaveLength(2);
    expect((s?.failures as { idx: number; status: number }[])[0]).toMatchObject({
      idx: 2,
      status: 429,
    });
  });
});
