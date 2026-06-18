/**
 * src/__tests__/feedback-format.test.ts
 *
 * src/lib/feedback/format.ts の純関数 helper を検証する。
 *
 * 検証観点:
 *   - formatFeedbackCategory: 内部値を日本語化 / 未知値は元値 / 空は "未選択"
 *   - extractOaWorkIds: path のみ / origin 付き URL / works なし / liff サフィックス / query・hash
 */

import { describe, it, expect } from "vitest";
import { formatFeedbackCategory, extractOaWorkIds } from "@/lib/feedback/format";

describe("formatFeedbackCategory", () => {
  it("内部値を日本語表示に変換する", () => {
    expect(formatFeedbackCategory("bug")).toBe("バグ報告");
    expect(formatFeedbackCategory("ux")).toBe("使いにくさ");
    expect(formatFeedbackCategory("feature")).toBe("欲しい機能");
    expect(formatFeedbackCategory("other")).toBe("その他");
    expect(formatFeedbackCategory("enterprise")).toBe("法人プラン相談");
  });

  it("feature が表示上 そのまま英語で出ない（欲しい機能 になる）", () => {
    expect(formatFeedbackCategory("feature")).not.toBe("feature");
    expect(formatFeedbackCategory("feature")).toBe("欲しい機能");
  });

  it("未知の値は落とさず元の値を返す", () => {
    expect(formatFeedbackCategory("something")).toBe("something");
  });

  it("空 / null / undefined は 未選択 にフォールバックする", () => {
    expect(formatFeedbackCategory("")).toBe("未選択");
    expect(formatFeedbackCategory("   ")).toBe("未選択");
    expect(formatFeedbackCategory(null)).toBe("未選択");
    expect(formatFeedbackCategory(undefined)).toBe("未選択");
  });
});

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
