// src/__tests__/liff-id-token.test.ts
// for LIFF プレイヤー連携: LINE ID トークン検証 verifyLiffIdToken と channelIdFromLiffId のユニット。
//   - fetchImpl を注入して LINE verify エンドポイントの応答を差し替える（実 fetch はしない）。
//   - 成功(sub 取得) / audience 不一致 / iss 不正 / 4xx / 5xx / 429 / network throw / 前提欠如 / sub 欠如 を区別。
//   - 一時障害(5xx/429/network) と トークン無効(4xx) の区別を厳密に検証（アカウント不正扱いにしない）。
import { describe, it, expect, vi } from "vitest";
import { verifyLiffIdToken, channelIdFromLiffId } from "@/lib/liff/id-token";

const CH = "1656565252"; // 期待する LINE Login チャネルID（= aud）。
const ISS = "https://access.line.me";
const SUB = "U0123456789abcdef0123456789abcdef"; // LINE User ID(sub)。

// fetch の Response 風スタブ（verify は status / ok / json のみ参照）。
function mkRes(status: number, payload?: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload,
  } as unknown as Response;
}
// 成功応答（iss/aud/sub すべて正しい）。
const okRes = (over: Record<string, unknown> = {}) =>
  mkRes(200, { iss: ISS, aud: CH, sub: SUB, exp: 9999999999, ...over });

describe("verifyLiffIdToken", () => {
  it("成功: 200 + 正しい iss/aud/sub → ok + lineUserId(sub)", async () => {
    const fetchImpl = vi.fn(async () => okRes());
    const r = await verifyLiffIdToken("id-token-value", CH, { fetchImpl });
    expect(r).toEqual({ ok: true, lineUserId: SUB });
    // LINE verify エンドポイントへ id_token + client_id を form-urlencoded で POST。
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.line.me/oauth2/v2.1/verify");
    expect(init.method).toBe("POST");
    const body = String(init.body);
    expect(body).toContain("id_token=id-token-value");
    expect(body).toContain(`client_id=${CH}`);
  });

  it("audience 不一致: aud≠channelId → audience_mismatch", async () => {
    const fetchImpl = vi.fn(async () => okRes({ aud: "9999999999" }));
    const r = await verifyLiffIdToken("t", CH, { fetchImpl });
    expect(r).toEqual({ ok: false, reason: "audience_mismatch" });
  });

  it("iss 不正 → token_invalid", async () => {
    const fetchImpl = vi.fn(async () => okRes({ iss: "https://evil.example.com" }));
    const r = await verifyLiffIdToken("t", CH, { fetchImpl });
    expect(r).toEqual({ ok: false, reason: "token_invalid" });
  });

  it("400 応答（署名不正/exp 切れ等）→ token_invalid", async () => {
    const fetchImpl = vi.fn(async () => mkRes(400, { error: "invalid_request" }));
    const r = await verifyLiffIdToken("t", CH, { fetchImpl });
    expect(r).toEqual({ ok: false, reason: "token_invalid" });
  });

  it("5xx → temporarily_unavailable（再試行可・アカウント不正扱いにしない）", async () => {
    const fetchImpl = vi.fn(async () => mkRes(503));
    const r = await verifyLiffIdToken("t", CH, { fetchImpl });
    expect(r).toEqual({ ok: false, reason: "temporarily_unavailable" });
  });

  it("429 → temporarily_unavailable（レート制限）", async () => {
    const fetchImpl = vi.fn(async () => mkRes(429));
    const r = await verifyLiffIdToken("t", CH, { fetchImpl });
    expect(r).toEqual({ ok: false, reason: "temporarily_unavailable" });
  });

  it("network throw → request_failed", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const r = await verifyLiffIdToken("t", CH, { fetchImpl });
    expect(r).toEqual({ ok: false, reason: "request_failed" });
  });

  it("idToken 欠如 → missing_id_token（fetch しない）", async () => {
    const fetchImpl = vi.fn(async () => okRes());
    for (const v of ["", "   ", null, undefined]) {
      const r = await verifyLiffIdToken(v, CH, { fetchImpl });
      expect(r).toEqual({ ok: false, reason: "missing_id_token" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("channelId 欠如 → missing_channel_id（fetch しない）", async () => {
    const fetchImpl = vi.fn(async () => okRes());
    for (const v of ["", "   ", null, undefined]) {
      const r = await verifyLiffIdToken("t", v, { fetchImpl });
      expect(r).toEqual({ ok: false, reason: "missing_channel_id" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sub 欠如 → no_sub", async () => {
    const fetchImpl = vi.fn(async () => okRes({ sub: "" }));
    const r = await verifyLiffIdToken("t", CH, { fetchImpl });
    expect(r).toEqual({ ok: false, reason: "no_sub" });
  });
});

describe("channelIdFromLiffId", () => {
  it("'{loginChannelId}-{liffAppId}' から数値プレフィックスを取り出す", () => {
    expect(channelIdFromLiffId("1656565252-abcd")).toBe("1656565252");
    expect(channelIdFromLiffId("  1656565252-abcd  ")).toBe("1656565252");
  });
  it("数値プレフィックスが無い/短すぎる → null", () => {
    expect(channelIdFromLiffId("abcd-1234")).toBeNull(); // 非数値プレフィックス
    expect(channelIdFromLiffId("1234-ab")).toBeNull(); // 5 桁未満
    expect(channelIdFromLiffId("1656565252")).toBeNull(); // ハイフン無し
    expect(channelIdFromLiffId("")).toBeNull();
    expect(channelIdFromLiffId(null)).toBeNull();
    expect(channelIdFromLiffId(undefined)).toBeNull();
  });
});
