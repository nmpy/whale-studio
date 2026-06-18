/**
 * src/__tests__/liff-ui-foundation.test.ts
 *
 * PR1 LIFF 新UI Foundation の純ロジック（tokens.ts）を検証する。
 * JSX 部品（.tsx）は vitest の jsx 設定都合で import しないため、純関数のみを対象にする。
 */
import { describe, it, expect } from "vitest";
import { cx, actionButtonClass } from "@/components/liff/ui/tokens";

describe("cx", () => {
  it("falsy を除外して space 連結", () => {
    expect(cx("a", false, "b", null, undefined, "c")).toBe("a b c");
    expect(cx()).toBe("");
  });
});

describe("actionButtonClass — ピルボタン", () => {
  it("既定 primary + fullWidth", () => {
    const c = actionButtonClass();
    expect(c).toContain("rounded-full");
    expect(c).toContain("--liff-line-green");
    expect(c).toContain("w-full");
  });
  it("variant=dark は primary-text 背景", () => {
    expect(actionButtonClass("dark")).toContain("--liff-primary-text");
  });
  it("fullWidth=false で w-full を付けない", () => {
    expect(actionButtonClass("primary", { fullWidth: false })).not.toContain("w-full");
  });
  it("追加 className を合成", () => {
    expect(actionButtonClass("outline", { className: "mt-2" })).toContain("mt-2");
  });
  it("CMS の brand class を含まない（漏れ防止）", () => {
    const c = actionButtonClass("primary");
    expect(c).not.toMatch(/bg-brand|buttonClass|ring-brand/);
  });
});
