/**
 * src/__tests__/liff-session.test.ts
 *
 * src/lib/liff/session.ts の verifyLiffAccessToken を検証する。
 * LINE プロフィール API への fetch を注入してモックする。
 *
 * 検証観点:
 *   - accessToken 未指定 → missing_access_token
 *   - 200 + userId → ok:true（サーバー検証済み lineUserId / displayName）
 *   - 200 だが userId 無し → no_user_id
 *   - 401/4xx → token_invalid（フロントの値を信用しない）
 *   - fetch 例外 / 非 JSON → request_failed
 *   - Authorization: Bearer ヘッダを付けて LINE profile API を叩く
 */

import { describe, it, expect, vi } from "vitest";
import { verifyLiffAccessToken } from "@/lib/liff/session";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("verifyLiffAccessToken", () => {
  it("accessToken 未指定 → missing_access_token（API を叩かない）", async () => {
    const fetchImpl = vi.fn();
    expect(await verifyLiffAccessToken("", { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .toEqual({ ok: false, reason: "missing_access_token" });
    expect(await verifyLiffAccessToken(null, { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .toEqual({ ok: false, reason: "missing_access_token" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("200 + userId → サーバー検証済み lineUserId / displayName", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { userId: "U123", displayName: "なみ" }));
    const r = await verifyLiffAccessToken("tok", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toEqual({ ok: true, lineUserId: "U123", displayName: "なみ" });
    // LINE profile API に Bearer で叩いていること
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[0])).toBe("https://api.line.me/v2/profile");
    expect(call[1].headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("displayName 無しでも ok（null）", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { userId: "U1" }));
    expect(await verifyLiffAccessToken("t", { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .toEqual({ ok: true, lineUserId: "U1", displayName: null });
  });

  it("200 だが userId 無し → no_user_id", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { displayName: "x" }));
    expect(await verifyLiffAccessToken("t", { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .toEqual({ ok: false, reason: "no_user_id" });
  });

  it("401（無効トークン）→ token_invalid", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { message: "invalid" }));
    expect(await verifyLiffAccessToken("bad", { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .toEqual({ ok: false, reason: "token_invalid" });
  });

  it("fetch 例外 → request_failed", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("network"); });
    expect(await verifyLiffAccessToken("t", { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .toEqual({ ok: false, reason: "request_failed" });
  });

  it("200 だが JSON parse 失敗 → request_failed", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } } as unknown as Response));
    expect(await verifyLiffAccessToken("t", { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .toEqual({ ok: false, reason: "request_failed" });
  });
});
