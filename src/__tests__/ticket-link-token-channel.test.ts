// src/__tests__/ticket-link-token-channel.test.ts
//
// アクセストークンの発行先チャネル束縛（strict）。
// 別 LINE Login チャネルで発行された有効トークンを流用できないことを検証する。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  loginChannelIdFromLiffId,
  expectedLoginChannelId,
  verifyTokenIssuedForOaChannel,
} from "@/lib/ticket-link/token-channel";

function fetchReturning(status: number, body: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

const savedEnv = process.env.NEXT_PUBLIC_LIFF_ID;
beforeEach(() => { delete process.env.NEXT_PUBLIC_LIFF_ID; });
afterEach(() => {
  if (savedEnv === undefined) delete process.env.NEXT_PUBLIC_LIFF_ID;
  else process.env.NEXT_PUBLIC_LIFF_ID = savedEnv;
});

describe("loginChannelIdFromLiffId", () => {
  it("LIFF ID のハイフン前をチャネル ID として取り出す", () => {
    expect(loginChannelIdFromLiffId("1234567890-abcdEFGH")).toBe("1234567890");
  });

  it("形式に合わない値は null", () => {
    expect(loginChannelIdFromLiffId("liff-1")).toBeNull();
    expect(loginChannelIdFromLiffId("1234567890")).toBeNull();
    expect(loginChannelIdFromLiffId("abc-defg")).toBeNull();
    expect(loginChannelIdFromLiffId("")).toBeNull();
    expect(loginChannelIdFromLiffId(null)).toBeNull();
  });
});

describe("expectedLoginChannelId", () => {
  it("Oa.liffId を優先する", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = "9999999999-zzzz";
    expect(expectedLoginChannelId("1234567890-abcd")).toBe("1234567890");
  });

  it("Oa.liffId が無ければ env にフォールバックする", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = "9999999999-zzzz";
    expect(expectedLoginChannelId(null)).toBe("9999999999");
  });

  it("どちらも無ければ null", () => {
    expect(expectedLoginChannelId(null)).toBeNull();
  });
});

describe("verifyTokenIssuedForOaChannel", () => {
  const LIFF = "1234567890-abcd";

  it("発行先が一致すれば ok", async () => {
    const r = await verifyTokenIssuedForOaChannel("t", LIFF, {
      fetchImpl: fetchReturning(200, { client_id: "1234567890", expires_in: 3600 }),
    });
    expect(r).toEqual({ kind: "ok", clientId: "1234567890" });
  });

  it("別チャネル発行のトークンは channel_mismatch（流用を防ぐ）", async () => {
    const r = await verifyTokenIssuedForOaChannel("t", LIFF, {
      fetchImpl: fetchReturning(200, { client_id: "8888888888", expires_in: 3600 }),
    });
    expect(r).toEqual({ kind: "channel_mismatch" });
  });

  it("期待チャネルを決められないときは fail closed（API を呼ばない）", async () => {
    let called = false;
    const spy = (async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; }) as unknown as typeof fetch;
    const r = await verifyTokenIssuedForOaChannel("t", "liff-1", { fetchImpl: spy });
    expect(r).toEqual({ kind: "expected_channel_unknown" });
    expect(called).toBe(false);
  });

  it("トークン未指定は token_invalid", async () => {
    expect(await verifyTokenIssuedForOaChannel("", LIFF)).toEqual({ kind: "token_invalid" });
    expect(await verifyTokenIssuedForOaChannel(null, LIFF)).toEqual({ kind: "token_invalid" });
  });

  it("400/401/403 は token_invalid", async () => {
    for (const s of [400, 401, 403]) {
      const r = await verifyTokenIssuedForOaChannel("t", LIFF, { fetchImpl: fetchReturning(s, {}) });
      expect(r).toEqual({ kind: "token_invalid" });
    }
  });

  it("期限切れ（expires_in <= 0）は token_invalid", async () => {
    const r = await verifyTokenIssuedForOaChannel("t", LIFF, {
      fetchImpl: fetchReturning(200, { client_id: "1234567890", expires_in: 0 }),
    });
    expect(r).toEqual({ kind: "token_invalid" });
  });

  it("client_id が無い応答は unavailable（一致とみなさない）", async () => {
    const r = await verifyTokenIssuedForOaChannel("t", LIFF, { fetchImpl: fetchReturning(200, {}) });
    expect(r).toEqual({ kind: "unavailable" });
  });

  it("5xx / 通信失敗は unavailable", async () => {
    const r1 = await verifyTokenIssuedForOaChannel("t", LIFF, { fetchImpl: fetchReturning(500, {}) });
    expect(r1).toEqual({ kind: "unavailable" });

    const boom = (async () => { throw new Error("network"); }) as unknown as typeof fetch;
    const r2 = await verifyTokenIssuedForOaChannel("t", LIFF, { fetchImpl: boom });
    expect(r2).toEqual({ kind: "unavailable" });
  });
});
