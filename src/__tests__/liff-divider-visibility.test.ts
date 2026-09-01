// src/__tests__/liff-divider-visibility.test.ts
//
// 横線（区切り線）の表示有無の設定:
//   - block_divider     … ブロックとブロックの間に自動で入る横線 (.liff-block-sep)
//   - accordion_divider … アコーディオン 1 項目ごとの行区切り線 (.liff-acc-sec)
// この 2 つは独立して選べる。
//
// 最重要の不変条件（2 つ）:
//   1. 未設定ページの root class は空文字のまま = 既存ページの DOM も計算値も変わらない
//   2. 階層を示す**縦のガイド線**は絶対に消えない（消すとネスト構造が読めなくなる）

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveBlockDivider,
  blockDividerClass,
  resolveAccordionDivider,
  accordionDividerClass,
  liffRootClass,
} from "@/components/liff/liff-style-helpers";
import { accordionDepthStyle } from "@/components/liff/accordion-depth-style";
import { liffPageConfigSettingsSchema } from "@/lib/validations";
import type { LiffPageConfigSettings } from "@/types";

const S = (o: Record<string, unknown>): LiffPageConfigSettings => o as LiffPageConfigSettings;
const CSS = readFileSync(join(process.cwd(), "src/app/liff/liff-font.css"), "utf8");

function ruleBody(css: string, selector: string): string | null {
  const i = css.indexOf(selector);
  if (i < 0) return null;
  const open = css.indexOf("{", i);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close).trim().replace(/;$/, "");
}

describe("後方互換 — 未設定ページは従来のまま", () => {
  it("未設定 / 空 / 不正値では root class が増えない", () => {
    expect(liffRootClass(undefined)).toBe("");
    expect(liffRootClass({})).toBe("");
    expect(liffRootClass(S({ block_divider: "none" }))).toBe("");
    expect(liffRootClass(S({ accordion_divider: null }))).toBe("");
    expect(liffRootClass(S({ block_divider: false, accordion_divider: 0 }))).toBe("");
  });
});

describe("ブロック間の横線（block_divider）", () => {
  it("未設定・不正値はすべて show（= 現行どおり表示）", () => {
    expect(resolveBlockDivider(undefined)).toBe("show");
    expect(resolveBlockDivider({})).toBe("show");
    expect(resolveBlockDivider(S({ block_divider: "none" }))).toBe("show");
    expect(resolveBlockDivider(S({ block_divider: null }))).toBe("show");
    expect(resolveBlockDivider(S({ block_divider: false }))).toBe("show");
  });

  it("hide のときだけ class が付く", () => {
    expect(blockDividerClass("show")).toBe("");
    expect(blockDividerClass("hide")).toBe("liff-divider--hide");
    expect(liffRootClass(S({ block_divider: "show" }))).toBe("");
    expect(liffRootClass(S({ block_divider: "hide" }))).toBe("liff-divider--hide");
  });

  it("線幅だけを 0 にし、余白（pb / mb）には触れない", () => {
    expect(ruleBody(CSS, ".liff-divider--hide .liff-block-sep {")).toBe("border-bottom-width: 0");
  });
});

describe("アコーディオンの行区切り線（accordion_divider）", () => {
  it("未設定・不正値はすべて show（= 現行どおり表示）", () => {
    expect(resolveAccordionDivider(undefined)).toBe("show");
    expect(resolveAccordionDivider({})).toBe("show");
    expect(resolveAccordionDivider(S({ accordion_divider: "none" }))).toBe("show");
    expect(resolveAccordionDivider(S({ accordion_divider: null }))).toBe("show");
  });

  it("hide のときだけ class が付く", () => {
    expect(accordionDividerClass("show")).toBe("");
    expect(accordionDividerClass("hide")).toBe("liff-acc-divider--hide");
    expect(liffRootClass(S({ accordion_divider: "hide" }))).toBe("liff-acc-divider--hide");
  });

  it("線幅だけを 0 にし、項目の高さ・余白には触れない", () => {
    expect(ruleBody(CSS, ".liff-acc-divider--hide .liff-acc-sec {")).toBe("border-bottom-width: 0");
  });

  it("renderer 側に .liff-acc-sec マーカーが depth ごとに付いている（CSS の当て先）", () => {
    for (const d of [1, 2, 3] as const) {
      expect(accordionDepthStyle(d).section).toContain("liff-acc-sec");
      expect(accordionDepthStyle(d).section).toContain(`liff-acc-sec--${d}`);
      // 横線そのもの（border-b）は renderer 側に残したまま、CSS で 0 にする方式
      expect(accordionDepthStyle(d).section).toContain("border-b");
    }
  });
});

describe("2 つの設定は独立している", () => {
  it("片方だけ / 両方 を指定できる", () => {
    expect(liffRootClass(S({ block_divider: "hide" }))).toBe("liff-divider--hide");
    expect(liffRootClass(S({ accordion_divider: "hide" }))).toBe("liff-acc-divider--hide");
    const both = liffRootClass(S({ block_divider: "hide", accordion_divider: "hide" }));
    expect(both).toContain("liff-divider--hide");
    expect(both).toContain("liff-acc-divider--hide");
  });
});

// 階層表現の主役である縦ガイド線 (panel の border-left) は絶対に消さない。
describe("階層を示す縦ガイド線は対象外", () => {
  it("accordion_divider のセレクタは .liff-acc-sec だけを狙っている", () => {
    const sels = CSS.split("\n")
      .filter((l) => l.includes("liff-acc-divider--hide") && l.includes("{"))
      .map((l) => l.slice(0, l.indexOf("{")).trim());
    expect(sels).toEqual([".liff-acc-divider--hide .liff-acc-sec"]);
  });

  it("panel は縦ガイド線 (border-l) を持ち続けている", () => {
    for (const d of [1, 2, 3] as const) {
      expect(accordionDepthStyle(d).panel).toContain("border-l");
    }
  });

  it("横線を消す CSS が panel (.liff-acc-p) に触れていない", () => {
    for (const l of CSS.split("\n").filter((x) => x.includes("divider--hide"))) {
      expect(l).not.toContain("liff-acc-p");
    }
  });
});

describe("保存バリデーション", () => {
  it("show / hide だけ通る", () => {
    for (const k of ["block_divider", "accordion_divider"]) {
      expect(liffPageConfigSettingsSchema.safeParse({ [k]: "show" }).success).toBe(true);
      expect(liffPageConfigSettingsSchema.safeParse({ [k]: "hide" }).success).toBe(true);
      expect(liffPageConfigSettingsSchema.safeParse({ [k]: "none" }).success).toBe(false);
      expect(liffPageConfigSettingsSchema.safeParse({ [k]: true }).success).toBe(false);
    }
    expect(liffPageConfigSettingsSchema.safeParse({}).success).toBe(true);
  });
});
