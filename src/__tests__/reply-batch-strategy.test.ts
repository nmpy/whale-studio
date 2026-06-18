// src/__tests__/reply-batch-strategy.test.ts
//
// replyWithLagToLine の送信戦略を検証する。
//   - 件数に関係なく 1件目: Reply API
//   - 2件目以降: Push API で1件ずつ順番に送信
//
// 背景:
//   Reply API は複数件まとめて送れるが、まとめ送信では message 間の
//   lag / typing / loading 演出が付かない。
//   Whale Studio では物語体験の順番・間・演出を優先する。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { replyWithLagToLine, type LineMessage } from "@/lib/line";

const REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const PUSH_URL  = "https://api.line.me/v2/bot/message/push";

function texts(n: number, lagMs = 1): LineMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    type: "text",
    text: `m${i + 1}`,
    _sourceMessageId: `id${i + 1}`,
    _lagMs: lagMs,
  }) as LineMessage);
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
      replyTotal: 1,
      pushTotal: 0,
      pushOk: 0,
      pushFail: 0,
    });
  });

  it("3通: 1通目Reply + 2通目以降Pushで順番に送る", async () => {
    setupFetch();
    await replyWithLagToLine("rt", texts(3), "U1", "tok");

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

  it("4通: 1通目Reply + 3件Push", async () => {
    setupFetch();
    await replyWithLagToLine("rt", texts(4), "U1", "tok");

    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(1);
    expect(pushes()).toHaveLength(3);
    expect(summary()).toMatchObject({
      strategy: "reply_first_push_rest",
      replyTotal: 1,
      pushTotal: 3,
      pushOk: 3,
      pushFail: 0,
    });
  });

  it("5通: 境界でも 1通目Reply + 4件Push", async () => {
    setupFetch();
    await replyWithLagToLine("rt", texts(5), "U1", "tok");

    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(1);
    expect(pushes()).toHaveLength(4);
    expect(summary()).toMatchObject({
      strategy: "reply_first_push_rest",
      replyTotal: 1,
      pushTotal: 4,
      pushOk: 4,
      pushFail: 0,
    });
  });

  it("6通以上でも同じく 1通目Reply + 残りPush に統一する", async () => {
    setupFetch();
    await replyWithLagToLine("rt", texts(6), "U1", "tok");

    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(1);
    expect(pushes()).toHaveLength(5);
    expect(pushes().every((p) => p.count === 1)).toBe(true);
    expect(summary()).toMatchObject({
      strategy: "reply_first_push_rest",
      replyTotal: 1,
      pushTotal: 5,
      pushOk: 5,
      pushFail: 0,
    });
  });

  it("Push月間上限超過(429)時、2通目以降の失敗をsummaryに記録する", async () => {
    setupFetch(429);
    await replyWithLagToLine("rt", texts(3), "U1", "tok");

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

  it("演出(_lagMs)ありの5件でも自動Pushされ、順番・間の演出を優先する", async () => {
    setupFetch();
    await replyWithLagToLine("rt", texts(5, 1), "U1", "tok");

    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(1);
    expect(pushes()).toHaveLength(4);

    const s = summary();
    expect(s).toMatchObject({
      strategy: "reply_first_push_rest",
      reason: "preserve_message_order_and_timing",
      replyTotal: 1,
      pushTotal: 4,
      pushFail: 0,
    });
  });
});
