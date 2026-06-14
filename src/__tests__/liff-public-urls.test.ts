/**
 * src/__tests__/liff-public-urls.test.ts
 *
 * ボタンリンクの遷移先解決（LIFFページ / ロケーション）で使う絶対URLビルダーを検証する。
 * - 絶対URLになること（Zod の z.string().url() を通すため）
 * - publicId が揃わないときは空文字（解決不可）
 */
import { describe, it, expect, beforeAll } from "vitest";
import { buildLiffPageUrl, buildLocationCheckinUrl } from "@/lib/liff/public-urls";

beforeAll(() => {
  // window が無い node 環境では NEXT_PUBLIC_BASE_URL を origin として使う
  process.env.NEXT_PUBLIC_BASE_URL = "https://example.test";
});

describe("buildLiffPageUrl", () => {
  it("publicId が揃えば短縮ルートの絶対URL", () => {
    expect(buildLiffPageUrl({ workPublicId: "wp123", pagePublicId: "pp456" }))
      .toBe("https://example.test/liff/w/wp123/p/pp456");
  });

  it("publicId が無ければ UUID ルートにフォールバック", () => {
    expect(buildLiffPageUrl({ workId: "w-uuid", pageId: "p-uuid" }))
      .toBe("https://example.test/liff/work/w-uuid/pages/p-uuid");
  });

  it("解決材料が無ければ空文字", () => {
    expect(buildLiffPageUrl({})).toBe("");
  });
});

describe("buildLocationCheckinUrl", () => {
  it("canonical チェックインURL（絶対）", () => {
    expect(buildLocationCheckinUrl({ workPublicId: "wp123", locationPublicId: "loc789" }))
      .toBe("https://example.test/liff/c/wp123/loc789");
  });

  it("publicId が片方でも欠ければ空文字", () => {
    expect(buildLocationCheckinUrl({ workPublicId: "wp123" })).toBe("");
    expect(buildLocationCheckinUrl({ locationPublicId: "loc789" })).toBe("");
  });
});
