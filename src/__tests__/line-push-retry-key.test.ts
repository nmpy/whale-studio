// src/__tests__/line-push-retry-key.test.ts
//
// pushToLine の retryKey は **additive な任意引数**。
// 3 引数で呼ぶ既存の呼び出し（応答メッセージ / webhook / reply / チェックイン等）は
// X-Line-Retry-Key を付けない従来挙動のままであることを固定する。

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { pushToLine } from "@/lib/line";

const U = "U" + "0".repeat(32);
const MSG = [{ type: "text" as const, text: "hi" }];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
  vi.stubGlobal("fetch", fetchMock);
});

const headersOfLastCall = (): Record<string, string> =>
  fetchMock.mock.calls[0][1].headers as Record<string, string>;

describe("pushToLine — 既存 caller への非影響（H）", () => {
  it("3 引数呼び出しでは X-Line-Retry-Key を付けない（従来どおり）", async () => {
    await pushToLine(U, MSG, "tok");
    const h = headersOfLastCall();
    expect(h["X-Line-Retry-Key"]).toBeUndefined();
    expect(Object.keys(h).sort()).toEqual(["Authorization", "Content-Type"]);
  });

  it("options を渡しても retryKey が無ければヘッダーを付けない", async () => {
    await pushToLine(U, MSG, "tok", {});
    expect(headersOfLastCall()["X-Line-Retry-Key"]).toBeUndefined();
  });

  it("3 引数呼び出しの戻り値契約は従来どおり { ok, status }", async () => {
    const r = await pushToLine(U, MSG, "tok");
    expect(r).toEqual({ ok: true, status: 200 });
  });
});

describe("pushToLine — 配信メッセージからの呼び出し", () => {
  it("retryKey を渡すと X-Line-Retry-Key ヘッダーが付く", async () => {
    const key = "11111111-2222-4333-8444-555555555555";
    await pushToLine(U, MSG, "tok", { retryKey: key });
    expect(headersOfLastCall()["X-Line-Retry-Key"]).toBe(key);
  });

  it("409 は ok:false / status:409 として呼び出し側へ返る（配信側で sent 相当に確定できる）", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, text: async () => "{}" });
    const r = await pushToLine(U, MSG, "tok", { retryKey: "k" });
    expect(r).toEqual({ ok: false, status: 409 });
  });
});
