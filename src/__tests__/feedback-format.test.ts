/**
 * src/__tests__/feedback-format.test.ts
 *
 * src/lib/feedback/format.ts の純関数 helper を検証する。
 *
 * 検証観点:
 *   - extractOaWorkIds: path のみ / origin 付き URL / works なし / liff サフィックス / query・hash
 *
 * ※ formatFeedbackCategory はカテゴリ廃止に伴い削除済み（テストも削除）。
 */

import { describe, it, expect } from "vitest";
import { extractOaWorkIds } from "@/lib/feedback/format";

describe("extractOaWorkIds", () => {
  it("path のみ (/oas/:oaId/works/:workId/liff) から両 ID を抽出する", () => {
    expect(
      extractOaWorkIds(
        "/oas/737bd78d-33e9-4adc-98b7-69e850e3b480/works/8f9e6ca9-1717-47a1-b414-5f4af379383f/liff",
      ),
    ).toEqual({
      oaId:   "737bd78d-33e9-4adc-98b7-69e850e3b480",
      workId: "8f9e6ca9-1717-47a1-b414-5f4af379383f",
    });
  });

  it("origin 付き URL からも抽出できる", () => {
    expect(
      extractOaWorkIds(
        "https://app.whale-studio.app/oas/oa123/works/work456/liff?foo=bar#sec",
      ),
    ).toEqual({ oaId: "oa123", workId: "work456" });
  });

  it("works を含まない URL では workId は null", () => {
    expect(extractOaWorkIds("/oas/oa123/settings")).toEqual({
      oaId:   "oa123",
      workId: null,
    });
  });

  it("oas を含まない URL では両方 null", () => {
    expect(extractOaWorkIds("/pricing")).toEqual({ oaId: null, workId: null });
  });

  it("null / undefined / 空文字は両方 null", () => {
    expect(extractOaWorkIds(null)).toEqual({ oaId: null, workId: null });
    expect(extractOaWorkIds(undefined)).toEqual({ oaId: null, workId: null });
    expect(extractOaWorkIds("")).toEqual({ oaId: null, workId: null });
  });
});
