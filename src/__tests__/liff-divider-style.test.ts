/**
 * src/__tests__/liff-divider-style.test.ts
 * PR-BLK4c: 区切り線 style の解決（純関数）+ additive validation。
 */
import { describe, it, expect } from "vitest";
import { resolveDividerStyle } from "@/components/liff/divider-style";
import { validateBlockSettings } from "@/lib/validations";

describe("resolveDividerStyle", () => {
  it("未設定は solid", () => {
    expect(resolveDividerStyle(undefined, undefined)).toBe("solid");
  });
  it("不明値は solid fallback", () => {
    expect(resolveDividerStyle("bogus", undefined)).toBe("solid");
    expect(resolveDividerStyle("double", undefined)).toBe("solid");
  });
  it("solid / dashed / dotted / thick は解決される", () => {
    expect(resolveDividerStyle("solid", undefined)).toBe("solid");
    expect(resolveDividerStyle("dashed", undefined)).toBe("dashed");
    expect(resolveDividerStyle("dotted", undefined)).toBe("dotted");
    expect(resolveDividerStyle("thick", undefined)).toBe("thick");
  });
  it("label + ラベルありは label", () => {
    expect(resolveDividerStyle("label", "Chapter 1")).toBe("label");
  });
  it("label + ラベル空（空文字/空白のみ）は solid に fallback", () => {
    expect(resolveDividerStyle("label", "")).toBe("solid");
    expect(resolveDividerStyle("label", "   ")).toBe("solid");
    expect(resolveDividerStyle("label", undefined)).toBe("solid");
  });
});

describe("divider settings validation（style 拡張 + label は additive）", () => {
  it("既存 divider settings（label なし）が通る（後方互換）", () => {
    expect(validateBlockSettings("divider", { style: "solid" }).success).toBe(true);
    expect(validateBlockSettings("divider", { style: "dashed" }).success).toBe(true);
    expect(validateBlockSettings("divider", {}).success).toBe(true);
  });
  it("dotted / thick / label を受理（label テキスト併用可）", () => {
    expect(validateBlockSettings("divider", { style: "dotted" }).success).toBe(true);
    expect(validateBlockSettings("divider", { style: "thick" }).success).toBe(true);
    expect(validateBlockSettings("divider", { style: "label", label: "手がかり" }).success).toBe(true);
  });
  it("label は optional（style だけでも通る）", () => {
    expect(validateBlockSettings("divider", { style: "label" }).success).toBe(true);
  });
  it("不正な style は reject（enum）", () => {
    expect(validateBlockSettings("divider", { style: "double" }).success).toBe(false);
  });
});
