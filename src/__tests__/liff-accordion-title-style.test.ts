// src/__tests__/liff-accordion-title-style.test.ts
//
// アコーディオン見出しだけの「文字サイズ (accordion_title_scale)」と
// 「見出し行の上下余白 (accordion_header_spacing)」のテスト。
//
// 背景:
//   これまでアコーディオン見出しの大きさは heading_scale（ページタイトル / 見出しブロックと共用）、
//   行の高さは layout_density（ページ全体と共用）でしか動かせなかった。
//   ここでアコーディオンだけを切り出せるようにする。
//
// 最重要の不変条件:
//   「未設定ページの root class は空文字のまま」= 既存ページの DOM も計算値も変わらない。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveAccordionTitleScale,
  accordionTitleScaleClass,
  resolveAccordionHeaderSpacing,
  accordionHeaderSpacingClass,
  liffRootClass,
} from "@/components/liff/liff-style-helpers";
import { liffPageConfigSettingsSchema } from "@/lib/validations";
import type { LiffPageConfigSettings } from "@/types";

const S = (o: Record<string, unknown>): LiffPageConfigSettings => o as LiffPageConfigSettings;
const CSS = readFileSync(join(process.cwd(), "src/app/liff/liff-font.css"), "utf8");

describe("後方互換 — 未設定ページは従来のまま", () => {
  it("未設定 / 空 / 不正値では root class が増えない", () => {
    expect(liffRootClass(undefined)).toBe("");
    expect(liffRootClass({})).toBe("");
    expect(liffRootClass(S({ accordion_title_scale: "huge" }))).toBe("");
    expect(liffRootClass(S({ accordion_header_spacing: "tight" }))).toBe("");
    expect(liffRootClass(S({ accordion_title_scale: null, accordion_header_spacing: false }))).toBe("");
  });

  it("未設定なら --liff-acc-title-mul は定義されず、heading 側にフォールバックする", () => {
    // .liff-h-acc--* が heading_mul へ連鎖する形になっていること
    for (const [d, px] of [[1, 16], [2, 15], [3, 14]] as const) {
      const rule = CSS.match(new RegExp(`\\.liff-font \\.liff-h-acc--${d}\\s+\\{[^}]*\\}`))?.[0] ?? "";
      expect(rule).toContain(`calc(${px}px * var(--liff-acc-title-mul, var(--liff-heading-mul, 1)))`);
    }
  });
});

describe("アコーディオン見出しの大きさ（accordion_title_scale）", () => {
  it("未設定 / 不正値は undefined（= 見出しの倍率に従う）", () => {
    expect(resolveAccordionTitleScale(undefined)).toBeUndefined();
    expect(resolveAccordionTitleScale({})).toBeUndefined();
    expect(resolveAccordionTitleScale(S({ accordion_title_scale: "huge" }))).toBeUndefined();
    expect(resolveAccordionTitleScale(S({ accordion_title_scale: null }))).toBeUndefined();
  });

  it("md も class を出す（= 見出しに追従せず等倍で固定する、という明示指定）", () => {
    expect(accordionTitleScaleClass(undefined)).toBe("");
    expect(accordionTitleScaleClass("sm")).toBe("liff-acc-title--sm");
    expect(accordionTitleScaleClass("md")).toBe("liff-acc-title--md");
    expect(accordionTitleScaleClass("lg")).toBe("liff-acc-title--lg");
    expect(accordionTitleScaleClass("xl")).toBe("liff-acc-title--xl");
  });

  it("heading_scale とは独立に効き、アコーディオン側が内側の倍率になる", () => {
    // 見出しは大きく、アコーディオンだけ等倍に固定できる
    const cls = liffRootClass(S({ heading_scale: "lg", accordion_title_scale: "md" }));
    expect(cls).toContain("liff-heading-size--lg");
    expect(cls).toContain("liff-acc-title--md");
  });

  it("CSS に 4 段階すべての倍率が定義されている", () => {
    for (const [name, mul] of [["sm", "0.93"], ["md", "1"], ["lg", "1.08"], ["xl", "1.16"]] as const) {
      expect(CSS).toContain(`.liff-acc-title--${name} { --liff-acc-title-mul: ${mul}; }`);
    }
  });
});

describe("アコーディオン見出し行の余白（accordion_header_spacing）", () => {
  it("未設定 / 不正値は undefined（= layout_density の結果のまま）", () => {
    expect(resolveAccordionHeaderSpacing(undefined)).toBeUndefined();
    expect(resolveAccordionHeaderSpacing({})).toBeUndefined();
    expect(resolveAccordionHeaderSpacing(S({ accordion_header_spacing: "tight" }))).toBeUndefined();
    expect(resolveAccordionHeaderSpacing(S({ accordion_header_spacing: 0 }))).toBeUndefined();
  });

  it("normal も class を出す（= density=compact でも詰めない、という明示指定）", () => {
    expect(accordionHeaderSpacingClass(undefined)).toBe("");
    expect(accordionHeaderSpacingClass("narrow")).toBe("liff-acc-head--narrow");
    expect(accordionHeaderSpacingClass("normal")).toBe("liff-acc-head--normal");
    expect(accordionHeaderSpacingClass("wide")).toBe("liff-acc-head--wide");
  });

  it("layout_density と併用でき、両方 root に載る", () => {
    const cls = liffRootClass(S({ layout_density: "compact", accordion_header_spacing: "normal" }));
    expect(cls).toContain("liff-density--compact");
    expect(cls).toContain("liff-acc-head--normal");
  });

  // 同 specificity (0,2,0) なので「後に書いたほう」が勝つ。順序が崩れると
  // アコーディオン専用指定が density に負けて効かなくなるため、ここで固定する。
  it("CSS 上でアコーディオン専用指定が density より後ろにある（= 後勝ちで優先）", () => {
    const density = CSS.indexOf(".liff-density--compact .liff-acc-h--1");
    const acc = CSS.indexOf(".liff-acc-head--normal .liff-acc-h--1");
    expect(density).toBeGreaterThan(-1);
    expect(acc).toBeGreaterThan(-1);
    expect(acc).toBeGreaterThan(density);
  });

  it("3 段階 × depth 3 のすべてに min-height と padding がある", () => {
    for (const name of ["narrow", "normal", "wide"]) {
      for (const d of [1, 2, 3]) {
        const rule = CSS.match(new RegExp(`\\.liff-acc-head--${name} \\.liff-acc-h--${d}\\s+\\{[^}]*\\}`))?.[0];
        expect(rule, `${name}/${d}`).toBeTruthy();
        expect(rule!).toContain("min-height:");
        expect(rule!).toContain("padding-top:");
        expect(rule!).toContain("padding-bottom:");
      }
    }
  });

  it("normal は現行既定と同値（= 見た目を変えずに density だけ打ち消せる）", () => {
    const expected = [[1, "60px", "12px"], [2, "52px", "10px"], [3, "46px", "8px"]] as const;
    for (const [d, mh, pad] of expected) {
      const rule = CSS.match(new RegExp(`\\.liff-acc-head--normal \\.liff-acc-h--${d}\\s+\\{[^}]*\\}`))![0];
      expect(rule).toContain(`min-height: ${mh}`);
      expect(rule).toContain(`padding-top: ${pad}`);
    }
  });

  // 本文パネル・インデント・縦ガイド線は階層表現の主役なので、この設定で動かさない。
  it("本文パネル (.liff-acc-p) には一切触れない", () => {
    const accRules = CSS.split("\n").filter((l) => l.includes(".liff-acc-head--"));
    expect(accRules.length).toBeGreaterThan(0);
    for (const l of accRules) expect(l).not.toContain("liff-acc-p");
  });
});

describe("保存バリデーション", () => {
  it("正しい値だけ通る", () => {
    for (const v of ["sm", "md", "lg", "xl"]) {
      expect(liffPageConfigSettingsSchema.safeParse({ accordion_title_scale: v }).success).toBe(true);
    }
    for (const v of ["narrow", "normal", "wide"]) {
      expect(liffPageConfigSettingsSchema.safeParse({ accordion_header_spacing: v }).success).toBe(true);
    }
    expect(liffPageConfigSettingsSchema.safeParse({ accordion_title_scale: "huge" }).success).toBe(false);
    expect(liffPageConfigSettingsSchema.safeParse({ accordion_header_spacing: "tight" }).success).toBe(false);
    expect(liffPageConfigSettingsSchema.safeParse({}).success).toBe(true);
  });
});
