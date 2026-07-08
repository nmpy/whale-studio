/**
 * src/__tests__/live-match-key.test.ts
 *
 * 予約番号 / チケットID 照合キー正規化（PR2b）の検証。
 */
import { describe, it, expect } from "vitest";
import { normalizeMatchKey, matchKeysEqual } from "@/lib/live-match-key";

describe("normalizeMatchKey", () => {
  it("trim する", () => {
    expect(normalizeMatchKey("  R-001  ")).toBe("R001");
  });
  it("全角英数字→半角", () => {
    expect(normalizeMatchKey("Ｒ－００１")).toBe("R001");
    expect(normalizeMatchKey("ＡＢ１２３")).toBe("AB123");
  });
  it("大文字小文字無視（大文字へ寄せる）", () => {
    expect(normalizeMatchKey("r-001")).toBe("R001");
    expect(normalizeMatchKey("abc")).toBe("ABC");
  });
  it("ハイフン類・空白・アンダースコアを除去", () => {
    expect(normalizeMatchKey("R - 0 0 1")).toBe("R001");
    expect(normalizeMatchKey("R_001")).toBe("R001");
    expect(normalizeMatchKey("R–001")).toBe("R001");   // en dash
    expect(normalizeMatchKey("R—001")).toBe("R001");   // em dash
    expect(normalizeMatchKey("R−001")).toBe("R001");   // U+2212 minus
    expect(normalizeMatchKey("R―001")).toBe("R001");   // horizontal bar
    expect(normalizeMatchKey("R　001")).toBe("R001");   // 全角スペース
  });
  it("空・null・undefined・記号のみは null", () => {
    expect(normalizeMatchKey("")).toBeNull();
    expect(normalizeMatchKey("   ")).toBeNull();
    expect(normalizeMatchKey("---")).toBeNull();
    expect(normalizeMatchKey(null)).toBeNull();
    expect(normalizeMatchKey(undefined)).toBeNull();
  });
});

describe("matchKeysEqual", () => {
  it("表記ゆれを吸収して一致", () => {
    expect(matchKeysEqual("R-001", "ｒ００１")).toBe(true);
    expect(matchKeysEqual("t 123", "T-123")).toBe(true);
    expect(matchKeysEqual("ABC-1", "abc1")).toBe(true);
  });
  it("異なる値は不一致", () => {
    expect(matchKeysEqual("R-001", "R-002")).toBe(false);
  });
  it("どちらかが空/null なら不一致（空同士も false）", () => {
    expect(matchKeysEqual("", "")).toBe(false);
    expect(matchKeysEqual("R-001", null)).toBe(false);
    expect(matchKeysEqual(null, "R-001")).toBe(false);
  });
});
