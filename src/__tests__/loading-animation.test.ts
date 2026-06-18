// src/__tests__/loading-animation.test.ts
//
// LINE Loading Animation（「入力中…」）まわりの検証。
//   - normalizeLoadingSeconds: LINE 有効値（5〜60・5刻み）への丸め
//   - showLoadingAnimation: 正規化した秒数を送る / 失敗してもメッセージ送信を止めない
//   - replyWithLagToLine: loading 設定のあるメッセージは「送信前」に loading/start を呼ぶ
//     （= メッセージ着信で消える前に入力中を出す。順序: reply → loading/start → push）

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizeLoadingSeconds,
  showLoadingAnimation,
  ReadReceiptController,
} from "@/lib/line-read-receipt";
import { replyWithLagToLine, type LineMessage } from "@/lib/line";

const REPLY_URL   = "https://api.line.me/v2/bot/message/reply";
const PUSH_URL    = "https://api.line.me/v2/bot/message/push";
const LOADING_URL = "https://api.line.me/v2/bot/chat/loading/start";

let origFetch: typeof global.fetch;

beforeEach(() => {
  origFetch = global.fetch;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = origFetch;
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────
// normalizeLoadingSeconds（純関数）
// ──────────────────────────────────────────────
describe("normalizeLoadingSeconds", () => {
  it("1〜4秒は5へ切り上げる", () => {
    expect(normalizeLoadingSeconds(1)).toBe(5);
    expect(normalizeLoadingSeconds(4)).toBe(5);
  });

  it("ちょうど5秒は5のまま", () => {
    expect(normalizeLoadingSeconds(5)).toBe(5);
  });

  it("6〜10秒は10へ切り上げる", () => {
    expect(normalizeLoadingSeconds(6)).toBe(10);
    expect(normalizeLoadingSeconds(10)).toBe(10);
  });

  it("11〜15秒は15へ切り上げる", () => {
    expect(normalizeLoadingSeconds(11)).toBe(15);
    expect(normalizeLoadingSeconds(15)).toBe(15);
  });

  it("60超は60にクランプ", () => {
    expect(normalizeLoadingSeconds(61)).toBe(60);
    expect(normalizeLoadingSeconds(1000)).toBe(60);
  });

  it("0・負値・最小未満は5にする", () => {
    expect(normalizeLoadingSeconds(0)).toBe(5);
    expect(normalizeLoadingSeconds(-3)).toBe(5);
  });

  it("未設定・NaN・Infinity は5（安全側）にする", () => {
    expect(normalizeLoadingSeconds(null)).toBe(5);
    expect(normalizeLoadingSeconds(undefined)).toBe(5);
    expect(normalizeLoadingSeconds(NaN)).toBe(5);
    expect(normalizeLoadingSeconds(Infinity)).toBe(5); // 非有限値は安全側で5
  });
});

// ──────────────────────────────────────────────
// showLoadingAnimation
// ──────────────────────────────────────────────
describe("showLoadingAnimation", () => {
  it("loadingSeconds を 5刻みに正規化して送る（7 → 10）", async () => {
    let sentBody: { chatId: string; loadingSeconds: number } | null = null;
    global.fetch = vi.fn(async (_url: unknown, init: unknown) => {
      sentBody = JSON.parse((init as { body: string }).body);
      return { ok: true, status: 200, text: async () => "" } as unknown as Response;
    }) as unknown as typeof global.fetch;

    const ok = await showLoadingAnimation("U1", 7, "tok");
    expect(ok).toBe(true);
    expect(sentBody!.chatId).toBe("U1");
    expect(sentBody!.loadingSeconds).toBe(10);
  });

  it("LINE が非2xxでも throw せず false を返す（送信は止めない）", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ message: "bad request" }),
    } as unknown as Response)) as unknown as typeof global.fetch;

    const ok = await showLoadingAnimation("U1", 5, "tok", { oaId: "oa1", workId: "w1", messageId: "m1" });
    expect(ok).toBe(false);
    // warning は出るが PII（全文 userId）は含めない
    const warned = (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls
      .some((c) => c[0] === "[line:loading:failed]");
    expect(warned).toBe(true);
  });

  it("fetch が throw しても catch して false を返す", async () => {
    global.fetch = vi.fn(async () => { throw new Error("network down"); }) as unknown as typeof global.fetch;
    const ok = await showLoadingAnimation("U1", 5, "tok");
    expect(ok).toBe(false);
  });
});

// ──────────────────────────────────────────────
// replyWithLagToLine: loading は「送信前」に呼ばれる
// ──────────────────────────────────────────────
describe("replyWithLagToLine × loading 表示タイミング", () => {
  function recordOrderFetch(): string[] {
    const order: string[] = [];
    global.fetch = vi.fn(async (url: unknown) => {
      order.push(String(url));
      return { ok: true, status: 200, text: async () => "" } as unknown as Response;
    }) as unknown as typeof global.fetch;
    return order;
  }

  it("2通目に loading 設定があると、その push の前に loading/start を呼ぶ", async () => {
    const order = recordOrderFetch();
    const ctrl = new ReadReceiptController({
      userId: "U1",
      channelAccessToken: "tok",
      isOneOnOne: true,
      oaId: "oa1",
      workId: "w1",
    });

    const messages: LineMessage[] = [
      { type: "text", text: "m1", _sourceMessageId: "id1" } as LineMessage,
      {
        type: "text", text: "m2", _sourceMessageId: "id2",
        _lagMs: 1, // テスト高速化（既定1000ms待機を避ける）
        _timing: { loading_enabled: true, loading_min_seconds: 5, loading_max_seconds: 5 },
      } as LineMessage,
    ];

    await replyWithLagToLine("rt", messages, "U1", "tok", ctrl);

    // 期待順序: reply(m1) → loading/start(m2用) → push(m2)
    expect(order[0]).toBe(REPLY_URL);
    const loadingIdx = order.indexOf(LOADING_URL);
    const pushIdx    = order.indexOf(PUSH_URL);
    expect(loadingIdx).toBeGreaterThan(0);            // reply の後
    expect(pushIdx).toBeGreaterThan(loadingIdx);      // loading の後に push
  });

  it("loading/start が失敗しても 2通目以降の push は継続する", async () => {
    const order: string[] = [];
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      order.push(u);
      // loading だけ失敗させる
      if (u === LOADING_URL) {
        return { ok: false, status: 500, text: async () => "err" } as unknown as Response;
      }
      return { ok: true, status: 200, text: async () => "" } as unknown as Response;
    }) as unknown as typeof global.fetch;

    const ctrl = new ReadReceiptController({
      userId: "U1", channelAccessToken: "tok", isOneOnOne: true,
    });
    const messages: LineMessage[] = [
      { type: "text", text: "m1", _sourceMessageId: "id1" } as LineMessage,
      {
        type: "text", text: "m2", _sourceMessageId: "id2", _lagMs: 1,
        _timing: { loading_enabled: true, loading_min_seconds: 5, loading_max_seconds: 5 },
      } as LineMessage,
    ];

    await replyWithLagToLine("rt", messages, "U1", "tok", ctrl);

    // loading 失敗後も push(m2) は送られている
    expect(order).toContain(PUSH_URL);
  });
});
