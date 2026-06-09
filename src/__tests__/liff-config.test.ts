/**
 * src/__tests__/liff-config.test.ts
 *
 * src/lib/liff/config.ts の純関数ヘルパーを検証する。
 *
 * 検証観点:
 *   - getLiffIdForOa: Oa.liffId → NEXT_PUBLIC_LIFF_ID → null の解決順
 *   - getLiffIdSource / isLiffConfigured
 *   - buildLiffUrl: path / query / 未設定
 *   - getRecommendedEndpointUrl: APP_URL → BASE_URL → 既定、/liff 付与
 *   - getLiffEndpointPath
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getLiffIdForOa,
  getLiffIdSource,
  isLiffConfigured,
  buildLiffUrl,
  getRecommendedEndpointUrl,
  getLiffEndpointPath,
} from "@/lib/liff/config";

const ENV_KEYS = ["NEXT_PUBLIC_LIFF_ID", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_BASE_URL"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getLiffIdForOa（解決順）", () => {
  it("Oa.liffId があれば最優先", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = "env-id";
    expect(getLiffIdForOa({ liffId: "oa-id" })).toBe("oa-id");
  });
  it("Oa.liffId が空/空白なら env にフォールバック", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = "env-id";
    expect(getLiffIdForOa({ liffId: "" })).toBe("env-id");
    expect(getLiffIdForOa({ liffId: "   " })).toBe("env-id");
    expect(getLiffIdForOa({ liffId: null })).toBe("env-id");
    expect(getLiffIdForOa(null)).toBe("env-id");
  });
  it("どちらも無ければ null", () => {
    expect(getLiffIdForOa({ liffId: null })).toBeNull();
    expect(getLiffIdForOa(undefined)).toBeNull();
  });
  it("前後空白は trim", () => {
    expect(getLiffIdForOa({ liffId: "  abc-DEF  " })).toBe("abc-DEF");
  });
});

describe("getLiffIdSource / isLiffConfigured", () => {
  it("source: oa / env / none", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = "env-id";
    expect(getLiffIdSource({ liffId: "oa-id" })).toBe("oa");
    expect(getLiffIdSource({ liffId: null })).toBe("env");
    delete process.env.NEXT_PUBLIC_LIFF_ID;
    expect(getLiffIdSource({ liffId: null })).toBe("none");
  });
  it("isLiffConfigured", () => {
    expect(isLiffConfigured({ liffId: "x" })).toBe(true);
    expect(isLiffConfigured({ liffId: null })).toBe(false);
  });
});

describe("buildLiffUrl", () => {
  it("liffId のみ → ベース URL", () => {
    expect(buildLiffUrl({ liffId: "123-abc" })).toBe("https://liff.line.me/123-abc");
  });
  it("path 付与（先頭スラッシュ正規化）", () => {
    expect(buildLiffUrl({ liffId: "123-abc", path: "w/xyz" })).toBe("https://liff.line.me/123-abc/w/xyz");
    expect(buildLiffUrl({ liffId: "123-abc", path: "/w/xyz" })).toBe("https://liff.line.me/123-abc/w/xyz");
  });
  it("query 付与（空値は除外）", () => {
    expect(buildLiffUrl({ liffId: "123", path: "/c", query: { loc: "L1", empty: "", n: 0, b: false } }))
      .toBe("https://liff.line.me/123/c?loc=L1&n=0&b=false");
  });
  it("liffId 未設定 → null", () => {
    expect(buildLiffUrl({ liffId: null })).toBeNull();
    expect(buildLiffUrl({ liffId: "  " })).toBeNull();
  });
});

describe("getRecommendedEndpointUrl / getLiffEndpointPath", () => {
  it("path は /liff", () => {
    expect(getLiffEndpointPath()).toBe("/liff");
  });
  it("APP_URL を最優先し /liff を付与（末尾スラッシュ正規化）", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com/";
    process.env.NEXT_PUBLIC_BASE_URL = "https://base.example.com";
    expect(getRecommendedEndpointUrl()).toBe("https://app.example.com/liff");
  });
  it("APP_URL 未設定なら BASE_URL", () => {
    process.env.NEXT_PUBLIC_BASE_URL = "https://base.example.com";
    expect(getRecommendedEndpointUrl()).toBe("https://base.example.com/liff");
  });
  it("どちらも未設定なら既定ドメイン", () => {
    expect(getRecommendedEndpointUrl()).toBe("https://app.whale-studio.app/liff");
  });
  it("originOverride を最優先", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    expect(getRecommendedEndpointUrl("https://preview.example.com")).toBe("https://preview.example.com/liff");
  });
});
