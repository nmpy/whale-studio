import { describe, it, expect } from "vitest";
import {
  normalizeBeaconHwid,
  tryNormalizeBeaconHwid,
  InvalidBeaconHwidError,
} from "@/lib/beacon-hwid";

describe("normalizeBeaconHwid", () => {
  it("trim + 小文字化する", () => {
    expect(normalizeBeaconHwid(" D41D8CD98F ")).toBe("d41d8cd98f");
  });

  it("内部の空白も除去する", () => {
    expect(normalizeBeaconHwid("D4 1D 8C D9 8F")).toBe("d41d8cd98f");
  });

  it("混在ケース（タブ・改行）も正規化する", () => {
    expect(normalizeBeaconHwid("\tab12\n34CD\t")).toBe("ab1234cd");
  });

  it("空文字列は InvalidBeaconHwidError を投げる", () => {
    expect(() => normalizeBeaconHwid("   ")).toThrow(InvalidBeaconHwidError);
  });

  it("英数字以外を含む場合はエラー", () => {
    expect(() => normalizeBeaconHwid("abcd-123")).toThrow(InvalidBeaconHwidError);
    expect(() => normalizeBeaconHwid("abc#1")).toThrow(InvalidBeaconHwidError);
    expect(() => normalizeBeaconHwid("ＡＢＣ１")).toThrow(InvalidBeaconHwidError);
  });

  it("非文字列はエラー", () => {
    expect(() => normalizeBeaconHwid(undefined)).toThrow(InvalidBeaconHwidError);
    expect(() => normalizeBeaconHwid(null)).toThrow(InvalidBeaconHwidError);
    expect(() => normalizeBeaconHwid(12345 as unknown)).toThrow(InvalidBeaconHwidError);
  });

  it("DB 保存と webhook 照合で同じ結果を返す（idempotent）", () => {
    const stored = normalizeBeaconHwid("AbC123");
    const fromWebhook = normalizeBeaconHwid("  abc123  ");
    expect(stored).toBe(fromWebhook);
  });
});

describe("tryNormalizeBeaconHwid", () => {
  it("成功時は { ok: true } を返す", () => {
    const r = tryNormalizeBeaconHwid("ABCD1234");
    expect(r).toEqual({ ok: true, hwid: "abcd1234" });
  });

  it("失敗時は { ok: false, error } を返す（throw しない）", () => {
    const r = tryNormalizeBeaconHwid("hello-world");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/英数字/);
    }
  });
});
