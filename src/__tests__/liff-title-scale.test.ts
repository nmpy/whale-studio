// src/__tests__/liff-title-scale.test.ts
//
// ページタイトルだけの文字サイズ (settings_json.title_scale)。
//
// 見出し系の倍率 heading_scale はページタイトル / アコーディオン見出し / 見出しブロックの
// 3 つをまとめて動かす。ここはそのうち**ページタイトルだけ**を切り出す設定で、
// accordion_title_scale（アコーディオン見出しだけを切り出す）と対になる。
//
// 最重要の不変条件: 未設定ページの root class は空文字のまま。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveTitleScale,
  titleScaleClass,
  resolveAccordionTitleScale,
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
    expect(liffRootClass(S({ title_scale: "huge" }))).toBe("");
    expect(liffRootClass(S({ title_scale: null }))).toBe("");
  });

  it("CSS は title → heading の順に var を連鎖している", () => {
    expect(CSS).toContain("calc(20px * var(--liff-title-mul, var(--liff-heading-mul, 1)))");
  });
});

describe("ページタイトルの大きさ（title_scale）", () => {
  it("未設定 / 不正値は undefined（= 見出しの倍率に従う）", () => {
    expect(resolveTitleScale(undefined)).toBeUndefined();
    expect(resolveTitleScale({})).toBeUndefined();
    expect(resolveTitleScale(S({ title_scale: "huge" }))).toBeUndefined();
    expect(resolveTitleScale(S({ title_scale: 0 }))).toBeUndefined();
  });

  it("md も class を出す（= 見出しに追従せず等倍で固定する、という明示指定）", () => {
    expect(titleScaleClass(undefined)).toBe("");
    expect(titleScaleClass("sm")).toBe("liff-title-size--sm");
    expect(titleScaleClass("md")).toBe("liff-title-size--md");
    expect(titleScaleClass("lg")).toBe("liff-title-size--lg");
    expect(titleScaleClass("xl")).toBe("liff-title-size--xl");
  });

  it("CSS に 4 段階すべての倍率が定義されている", () => {
    for (const [n, mul] of [["sm", "0.93"], ["md", "1"], ["lg", "1.08"], ["xl", "1.16"]] as const) {
      expect(CSS).toContain(`.liff-title-size--${n} { --liff-title-mul: ${mul}; }`);
    }
  });

  it("heading_scale とは独立に効く（見出しは大きく、タイトルだけ等倍で固定）", () => {
    const cls = liffRootClass(S({ heading_scale: "lg", title_scale: "md" }));
    expect(cls).toContain("liff-heading-size--lg");
    expect(cls).toContain("liff-title-size--md");
  });
});

// title_scale（ページタイトル）と accordion_title_scale（アコーディオン見出し）は
// どちらも heading_scale の内側に入る兄弟設定。互いに干渉しないことを固定する。
describe("accordion_title_scale と独立している", () => {
  it("別々の var を使っており、片方だけ / 両方 を指定できる", () => {
    expect(CSS).toContain("--liff-title-mul");
    expect(CSS).toContain("--liff-acc-title-mul");

    expect(liffRootClass(S({ title_scale: "lg" }))).toBe("liff-title-size--lg");
    expect(liffRootClass(S({ accordion_title_scale: "lg" }))).toBe("liff-acc-title--lg");

    const both = liffRootClass(S({ title_scale: "xl", accordion_title_scale: "sm" }));
    expect(both).toContain("liff-title-size--xl");
    expect(both).toContain("liff-acc-title--sm");
  });

  it("title_scale を指定してもアコーディオン側の解決は変わらない", () => {
    expect(resolveAccordionTitleScale(S({ title_scale: "xl" }))).toBeUndefined();
    expect(resolveTitleScale(S({ accordion_title_scale: "xl" }))).toBeUndefined();
  });

  it("ページタイトルの rule はアコーディオンの var を読まない（取り違え防止）", () => {
    const line = CSS.split("\n").find((l) => l.includes(".liff-font .liff-h-title   {"))!;
    expect(line).toContain("--liff-title-mul");
    expect(line).not.toContain("--liff-acc-title-mul");
  });
});

describe("保存バリデーション", () => {
  it("4 段階だけ通る", () => {
    for (const v of ["sm", "md", "lg", "xl"]) {
      expect(liffPageConfigSettingsSchema.safeParse({ title_scale: v }).success).toBe(true);
    }
    expect(liffPageConfigSettingsSchema.safeParse({ title_scale: "huge" }).success).toBe(false);
    expect(liffPageConfigSettingsSchema.safeParse({ title_scale: true }).success).toBe(false);
    expect(liffPageConfigSettingsSchema.safeParse({}).success).toBe(true);
  });
});
