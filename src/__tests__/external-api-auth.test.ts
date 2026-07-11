/**
 * src/__tests__/external-api-auth.test.ts
 *
 * src/lib/external-auth.ts の APIキー認証ガードを検証する。
 *
 * 検証:
 *   - WHALE_EXTERNAL_API_KEY 未設定 → 503（fail closed / 設定不備）
 *   - x-whale-api-key ヘッダーなし → 401
 *   - APIキー不一致 → 401
 *   - APIキー一致 → ok=true + scope
 *   - WHALE_EXTERNAL_OA_IDS のカンマ区切り allowlist が正しく解決される
 *   - allowlist 未設定 → 空集合（deny all / fail closed）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { requireExternalApiKey } from "@/lib/external-auth";

const API_KEY = "test-secret-key-1234567890";

/** x-whale-api-key ヘッダーだけを持つ最小の NextRequest 相当を作る。 */
function makeReq(key?: string): NextRequest {
  const headers = new Headers();
  if (key !== undefined) headers.set("x-whale-api-key", key);
  return { headers } as unknown as NextRequest;
}

const ENV_KEYS = ["WHALE_EXTERNAL_API_KEY", "WHALE_EXTERNAL_OA_IDS"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.WHALE_EXTERNAL_API_KEY = API_KEY;
  process.env.WHALE_EXTERNAL_OA_IDS = "oa-a,oa-b";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("requireExternalApiKey", () => {
  it("APIキー env 未設定 → 503（fail closed）", async () => {
    delete process.env.WHALE_EXTERNAL_API_KEY;
    const res = requireExternalApiKey(makeReq(API_KEY));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.response.status).toBe(503);
    const body = await res.response.json();
    expect(body.error.code).toBe("CONFIG_ERROR");
  });

  it("ヘッダーなし → 401", async () => {
    const res = requireExternalApiKey(makeReq());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.response.status).toBe(401);
    const body = await res.response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("APIキー不一致 → 401", async () => {
    const res = requireExternalApiKey(makeReq("wrong-key"));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.response.status).toBe(401);
  });

  it("APIキー一致 → ok=true + scope", () => {
    const res = requireExternalApiKey(makeReq(API_KEY));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.scope.oaIds).toEqual(["oa-a", "oa-b"]);
  });

  it("allowlist はカンマ区切り + 前後空白 + 空要素を正規化する", () => {
    process.env.WHALE_EXTERNAL_OA_IDS = " oa-a , oa-b ,, oa-c ,";
    const res = requireExternalApiKey(makeReq(API_KEY));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.scope.oaIds).toEqual(["oa-a", "oa-b", "oa-c"]);
    expect(res.scope.allowsOa("oa-b")).toBe(true);
    expect(res.scope.allowsOa("oa-x")).toBe(false);
  });

  it("allowlist 未設定 → 空集合（deny all）", () => {
    delete process.env.WHALE_EXTERNAL_OA_IDS;
    const res = requireExternalApiKey(makeReq(API_KEY));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.scope.oaIds).toEqual([]);
    expect(res.scope.allowsOa("oa-a")).toBe(false);
  });
});
