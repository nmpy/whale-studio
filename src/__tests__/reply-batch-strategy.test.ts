// src/__tests__/reply-batch-strategy.test.ts
//
// replyWithLagToLine の送信戦略を検証する。
//   - 5件以内: Reply API 1回で全件（Push API を呼ばない＝月間通数を消費しない）
//   - 6件以上: 先頭5件を Reply、6件目以降を Push（fallback）
// 背景: 2通目以降を Push にしていたため、Push 月間上限超過時に「1通目だけ届く」事故が起きた。

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
  it("3通: Reply API 1回で3件送る / Push を呼ばない", async () => {
    setupFetch();
    await replyWithLagToLine("rt", texts(3), "U1", "tok");
    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(3);
    expect(pushes()).toHaveLength(0);
    expect(summary()).toMatchObject({ strategy: "reply_all", replyTotal: 3, pushTotal: 0, pushFail: 0 });
  });

  it("4通: Reply API 1回で4件送る（見せてほしい分岐相当）", async () => {
    setupFetch();
    await replyWithLagToLine("rt", texts(4), "U1", "tok");
    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(4);
    expect(pushes()).toHaveLength(0);
    expect(summary()).toMatchObject({ strategy: "reply_all", replyTotal: 4, pushTotal: 0 });
  });

  it("5通: Reply API 1回で5件送る（境界）", async () => {
    setupFetch();
    await replyWithLagToLine("rt", texts(5), "U1", "tok");
    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(5);
    expect(pushes()).toHaveLength(0);
    expect(summary()).toMatchObject({ strategy: "reply_all", replyTotal: 5, pushTotal: 0 });
  });

  it("6通: Reply API で先頭5件 + Push API で1件（fallback）", async () => {
    setupFetch();
    await replyWithLagToLine("rt", texts(6, 1), "U1", "tok");
    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(5);
    expect(pushes()).toHaveLength(1);
    expect(pushes()[0].count).toBe(1);
    expect(summary()).toMatchObject({
      strategy: "reply_first_5_push_rest", replyTotal: 5, pushTotal: 1, pushOk: 1, pushFail: 0,
    });
  });

  it("Push月間上限超過(429)でも、5件以内は Push を呼ばず Reply のみで届く", async () => {
    setupFetch(429); // push は失敗する設定だが…
    await replyWithLagToLine("rt", texts(3), "U1", "tok");
    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(3);
    expect(pushes()).toHaveLength(0); // reply_all なので push は一切呼ばれない
    expect(summary()).toMatchObject({ strategy: "reply_all", pushTotal: 0, pushFail: 0 });
  });

  it("6通で Push 失敗(429)時、summary に pushFail と failures が記録される", async () => {
    setupFetch(429);
    await replyWithLagToLine("rt", texts(6, 1), "U1", "tok");
    expect(replies()[0].count).toBe(5);
    expect(pushes()).toHaveLength(1);
    const s = summary();
    expect(s).toMatchObject({ strategy: "reply_first_5_push_rest", pushTotal: 1, pushOk: 0, pushFail: 1 });
    expect((s?.failures as unknown[])).toHaveLength(1);
    expect((s?.failures as { status: number }[])[0].status).toBe(429);
  });

  // ── まとめ送信廃止方針 Phase 1: 意図しない Push 化を防ぐ回帰テスト ──
  // 演出（_lagMs / _timing）ありのチェーンでも、5件以内なら自動で Push 化せず Reply 一括のまま。
  // （per-message 自動 Push 戦略には切り替えない＝LINE 月間通数を勝手に消費しない）
  it("演出(_lagMs)ありでも5件以内は自動 Push されず Reply 一括のまま（Push API を呼ばない）", async () => {
    setupFetch();
    await replyWithLagToLine("rt", texts(3, 5000), "U1", "tok"); // 全件 _lagMs=5000（2通目以降に演出あり）
    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(3);   // 3件まとめて Reply
    expect(pushes()).toHaveLength(0);     // Push API は一切呼ばれない
    const s = summary();
    expect(s).toMatchObject({ strategy: "reply_all", replyTotal: 3, pushTotal: 0, pushFail: 0 });
    expect(s?.strategy).not.toBe("reply_head_push_rest_timed"); // per-message 自動 Push 戦略に切り替わらない
  });

  it("演出ありちょうど5件でも自動 Push されない（境界・意図しない Push 化防止）", async () => {
    setupFetch();
    await replyWithLagToLine("rt", texts(5, 5000), "U1", "tok");
    expect(replies()).toHaveLength(1);
    expect(replies()[0].count).toBe(5);
    expect(pushes()).toHaveLength(0);
    expect(summary()).toMatchObject({ strategy: "reply_all", pushTotal: 0 });
  });
});
