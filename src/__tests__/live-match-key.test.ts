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

/**
 * UZU Pro CMS との**共通ベクタ**。
 * UZU 側 `tests/unit/reservation-key.test.ts` の SHARED_VECTORS と同一の入力→期待値でなければならない。
 * 予約番号の照合は両システムで同じキーになることが前提であり、片方だけ変更すると静かに壊れる。
 * 変更時は必ず両 repo を同時に更新すること。
 */
describe("共通ベクタ（UZU Pro の normalizeReservationKey と一致すること）", () => {
  const SHARED_VECTORS: ReadonlyArray<{ input: string | null | undefined; expected: string | null; note: string }> = [
    { input: "ESC-12345", expected: "ESC12345", note: "半角ハイフンを除去" },
    { input: "esc-12345", expected: "ESC12345", note: "小文字を大文字へ" },
    { input: "ＥＳＣ－１２３４５", expected: "ESC12345", note: "全角英数字と全角ハイフンマイナス" },
    { input: "１２３４５", expected: "12345", note: "全角数字のみ" },
    { input: "  ESC 12345  ", expected: "ESC12345", note: "前後と内部の空白を除去" },
    { input: "ESC　12345", expected: "ESC12345", note: "全角スペース" },
    { input: "ESC_12345", expected: "ESC12345", note: "アンダースコアを除去" },
    { input: "ESC‐12345", expected: "ESC12345", note: "U+2010 HYPHEN" },
    { input: "ESC‑12345", expected: "ESC12345", note: "U+2011 NON-BREAKING HYPHEN" },
    { input: "ESC–12345", expected: "ESC12345", note: "U+2013 EN DASH" },
    { input: "ESC—12345", expected: "ESC12345", note: "U+2014 EM DASH" },
    { input: "ESC―12345", expected: "ESC12345", note: "U+2015 HORIZONTAL BAR" },
    { input: "ESC−12345", expected: "ESC12345", note: "U+2212 MINUS SIGN" },
    { input: "", expected: null, note: "空文字" },
    { input: "   ", expected: null, note: "空白のみ" },
    { input: "---", expected: null, note: "ハイフンのみ → 除去後に空" },
    { input: null, expected: null, note: "null" },
    { input: undefined, expected: null, note: "undefined" },
    { input: "A1", expected: "A1", note: "変換不要" },
  ];

  for (const v of SHARED_VECTORS) {
    it(`${JSON.stringify(v.input)} → ${JSON.stringify(v.expected)}（${v.note}）`, () => {
      expect(normalizeMatchKey(v.input)).toBe(v.expected);
    });
  }
});
