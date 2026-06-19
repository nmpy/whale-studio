/**
 * src/__tests__/liff-ui-foundation.test.ts
 *
 * LIFF 新UI Foundation の純ロジック / token（tokens.ts）を新デザインシステム仕様で検証する。
 * JSX 部品（.tsx）は vitest の jsx 設定都合で import しないため、純関数 / 定数のみを対象にする。
 */
import { describe, it, expect } from "vitest";
import {
  cx, actionButtonClass,
  LIFF_TINT, LIFF_GREEN_PRESSED, LIFF_BRAND,
  LIFF_CARD_CLASS, LIFF_RADIUS, LIFF_TEXT, LIFF_UI_FONT_STACK,
} from "@/components/liff/ui/tokens";

describe("cx", () => {
  it("falsy を除外して space 連結", () => {
    expect(cx("a", false, "b", null, undefined, "c")).toBe("a b c");
    expect(cx()).toBe("");
  });
});

describe("token 値（新スペック）", () => {
  it("Brand: primary #06C755 / pressed #06A047 / tint #E8F9EE", () => {
    expect(LIFF_BRAND).toBe("#06C755");
    expect(LIFF_GREEN_PRESSED).toBe("#06A047");
    expect(LIFF_TINT).toBe("#E8F9EE");
  });
  it("radius: card 10 / button 12 / badge 2 / capsule 16", () => {
    expect(LIFF_RADIUS.card).toBe("10px");
    expect(LIFF_RADIUS.button).toBe("12px");
    expect(LIFF_RADIUS.badge).toBe("2px");
    expect(LIFF_RADIUS.capsule).toBe("16px");
  });
  it("card class: rounded-[10px] + shadow 0 1px 3px rgba(0,0,0,.05)", () => {
    expect(LIFF_CARD_CLASS).toContain("rounded-[10px]");
    expect(LIFF_CARD_CLASS).toContain("shadow-[0_1px_3px_rgba(0,0,0,0.05)]");
    // 旧値が残っていないこと
    expect(LIFF_CARD_CLASS).not.toContain("rounded-[18px]");
    expect(LIFF_CARD_CLASS).not.toContain("rgba(31,64,92");
  });
  it("typography: pageTitle 20/500 / header 15/700 / body 14/400/1.85 / caption 12.5", () => {
    expect(LIFF_TEXT.pageTitle).toContain("text-[20px]");
    expect(LIFF_TEXT.pageTitle).toContain("font-medium");
    expect(LIFF_TEXT.headerTitle).toContain("text-[15px]");
    expect(LIFF_TEXT.headerTitle).toContain("font-bold");
    expect(LIFF_TEXT.body).toContain("text-[14px]");
    expect(LIFF_TEXT.body).toContain("leading-[1.85]");
    expect(LIFF_TEXT.caption).toContain("text-[12.5px]");
  });
  it("font stack: LINE Seed JP を含まない / letter-spacing token を持たない", () => {
    expect(LIFF_UI_FONT_STACK).not.toMatch(/LINE Seed/i);
    expect(LIFF_UI_FONT_STACK).toContain("Hiragino Sans");
    expect(LIFF_UI_FONT_STACK).toContain("Noto Sans JP");
    expect(LIFF_UI_FONT_STACK).not.toMatch(/letter-spacing/i);
  });
});

describe("actionButtonClass — 箱型ボタン（新仕様）", () => {
  it("既定 filled + 箱 radius12 + fullWidth", () => {
    const c = actionButtonClass();
    expect(c).toContain("rounded-[12px]");
    expect(c).toContain("--liff-line-green");
    expect(c).toContain("w-full");
    // ピルでないこと
    expect(c).not.toContain("rounded-full");
    expect(c).not.toContain("min-h-[52px]");
  });
  it("filled は緑塗り + 押下 #06A047", () => {
    const c = actionButtonClass("filled");
    expect(c).toContain("bg-[color:var(--liff-line-green,#06C755)]");
    expect(c).toContain("#06A047");
  });
  it("outline は緑枠 + 白背景", () => {
    const c = actionButtonClass("outline");
    expect(c).toContain("bg-[color:var(--liff-surface,#fff)]");
    expect(c).toContain("border");
  });
  it("disabled state class を含む", () => {
    expect(actionButtonClass()).toContain("disabled:opacity-50");
  });
  it("fullWidth=false で w-full を付けない / className 合成", () => {
    expect(actionButtonClass("filled", { fullWidth: false })).not.toContain("w-full");
    expect(actionButtonClass("outline", { className: "mt-2" })).toContain("mt-2");
  });
});

describe("CMS 漏れ防止", () => {
  it("token に CMS brand / loader / buttonClass / ring-brand が含まれない", () => {
    const blob = [
      actionButtonClass("filled"), actionButtonClass("outline"),
      LIFF_CARD_CLASS, LIFF_TINT, LIFF_UI_FONT_STACK,
      LIFF_TEXT.pageTitle, LIFF_TEXT.body,
    ].join(" ");
    expect(blob).not.toMatch(/bg-brand|buttonClass|ring-brand|InlineWhaleLoader|WhaleLoader|#22c55e/);
  });
});
