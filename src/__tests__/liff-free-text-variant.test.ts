/**
 * src/__tests__/liff-free-text-variant.test.ts
 * PR-BLK4e: フリーテキスト表示スタイル（variant）の解決（純関数）+ additive validation。
 */
import { describe, it, expect } from "vitest";
import { resolveFreeTextVariant } from "@/components/liff/free-text-variant";
import { validateBlockSettings } from "@/lib/validations";

describe("resolveFreeTextVariant", () => {
  it("未設定は body", () => {
    expect(resolveFreeTextVariant(undefined)).toBe("body");
  });
  it("body は body", () => {
    expect(resolveFreeTextVariant("body")).toBe("body");
  });
  it("sub は sub", () => {
    expect(resolveFreeTextVariant("sub")).toBe("sub");
  });
  it("不明値は body fallback", () => {
    expect(resolveFreeTextVariant("caption")).toBe("body");
    expect(resolveFreeTextVariant("")).toBe("body");
  });
});

describe("free_text settings validation（variant は additive・任意）", () => {
  it("既存 settings（variant なし）が通る（後方互換）", () => {
    expect(validateBlockSettings("free_text", { body: "本文", align: "left", emphasis: "normal" }).success).toBe(true);
    expect(validateBlockSettings("free_text", {}).success).toBe(true);
  });
  it("variant body / sub を受理（既存 key と併用可）", () => {
    expect(validateBlockSettings("free_text", { body: "x", variant: "body" }).success).toBe(true);
    expect(validateBlockSettings("free_text", { body: "x", variant: "sub", align: "center", emphasis: "strong" }).success).toBe(true);
  });
  it("不正な variant は reject（enum）", () => {
    expect(validateBlockSettings("free_text", { body: "x", variant: "caption" }).success).toBe(false);
  });
});
