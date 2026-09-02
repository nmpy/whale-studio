// src/__tests__/liff-font-scale-range.test.ts
//
// 文字サイズの段階を xs (0.85) / xxl (1.30) まで広げる。
//
// LiffFontScale は 4 つの設定が共有している:
//   font_scale / heading_scale / title_scale / accordion_title_scale
// どれか 1 つでも取りこぼすと「CMS には出るのに効かない段階」ができるため、
// 型・class 関数・CSS・保存バリデーションの 4 層すべてを全数で突き合わせる。
//
// 最重要の不変条件: 既存の 4 段階の値は 1 つも変わらない。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fontScaleClass,
  headingScaleClass,
  titleScaleClass,
  accordionTitleScaleClass,
  resolveFontScale,
  resolveHeadingScale,
  liffRootClass,
} from "@/components/liff/liff-style-helpers";
import { liffPageConfigSettingsSchema } from "@/lib/validations";
import type { LiffFontScale, LiffPageConfigSettings } from "@/types";

const S = (o: Record<string, unknown>): LiffPageConfigSettings => o as LiffPageConfigSettings;
const CSS = readFileSync(join(process.cwd(), "src/app/liff/liff-font.css"), "utf8");

const MUL: Record<Exclude<LiffFontScale, "md">, string> = {
  xs: "0.85", sm: "0.93", lg: "1.08", xl: "1.16", xxl: "1.30",
};

// [設定キー, class 関数, CSS の prefix, CSS 変数]
const TARGETS = [
  ["font_scale",            fontScaleClass,           "liff-font-size",    "--liff-fs-mul"],
  ["heading_scale",         headingScaleClass,        "liff-heading-size", "--liff-heading-mul"],
  ["title_scale",           titleScaleClass,          "liff-title-size",   "--liff-title-mul"],
  ["accordion_title_scale", accordionTitleScaleClass, "liff-acc-title",    "--liff-acc-title-mul"],
] as const;

describe("後方互換 — 既存 4 段階は不変", () => {
  it("未設定ページの root class は空文字のまま", () => {
    expect(liffRootClass(undefined)).toBe("");
    expect(liffRootClass({})).toBe("");
  });

  it("sm / lg / xl の倍率は従来値のまま", () => {
    for (const [, , prefix, v] of TARGETS) {
      for (const k of ["sm", "lg", "xl"] as const) {
        expect(CSS, `${prefix}--${k}`).toContain(`.${prefix}--${k} { ${v}: ${MUL[k]}; }`);
      }
    }
  });

  it("未知の段階は従来どおり既定へフォールバックする", () => {
    expect(resolveFontScale(S({ font_scale: "xxxl" }))).toBe("md");
    expect(resolveHeadingScale(S({ heading_scale: "tiny" }))).toBe("md");
  });
});

describe("xs / xxl が 4 設定すべてに通っている", () => {
  it("class 関数が xs / xxl を返す", () => {
    for (const [key, fn, prefix] of TARGETS) {
      expect(fn("xs"), `${key} の xs`).toBe(`${prefix}--xs`);
      expect(fn("xxl"), `${key} の xxl`).toBe(`${prefix}--xxl`);
    }
  });

  it("CSS に xs / xxl の倍率が定義されている", () => {
    for (const [, , prefix, v] of TARGETS) {
      expect(CSS, `${prefix}--xs`).toContain(`.${prefix}--xs { ${v}: 0.85; }`);
      expect(CSS, `${prefix}--xxl`).toContain(`.${prefix}--xxl { ${v}: 1.30; }`);
    }
  });

  it("保存バリデーションが 4 設定とも 6 段階を通す", () => {
    for (const [key] of TARGETS) {
      for (const v of ["xs", "sm", "md", "lg", "xl", "xxl"]) {
        expect(liffPageConfigSettingsSchema.safeParse({ [key]: v }).success, `${key}=${v}`).toBe(true);
      }
      expect(liffPageConfigSettingsSchema.safeParse({ [key]: "xxxl" }).success, key).toBe(false);
    }
  });

  // class 関数が返す class が CSS に無いと、CMS で選べるのに何も起きない。
  it("class 関数が返す class は全段階 CSS に実在する（全数）", () => {
    for (const [key, fn] of TARGETS) {
      for (const v of ["xs", "sm", "lg", "xl", "xxl"] as const) {
        const cls = fn(v);
        expect(cls, `${key}=${v} が class を返さない`).not.toBe("");
        expect(CSS.includes(`.${cls} {`), `${key}=${v} の ${cls} が CSS に無い`).toBe(true);
      }
    }
  });
});

describe("段階どうしの関係", () => {
  it("xs < sm < md(1) < lg < xl < xxl の順に大きくなる", () => {
    const order = [0.85, 0.93, 1, 1.08, 1.16, 1.30];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("4 設定を別々の段階に指定できる", () => {
    const cls = liffRootClass(S({
      font_scale: "xxl", heading_scale: "xs", title_scale: "lg", accordion_title_scale: "sm",
    }));
    expect(cls).toContain("liff-font-size--xxl");
    expect(cls).toContain("liff-heading-size--xs");
    expect(cls).toContain("liff-title-size--lg");
    expect(cls).toContain("liff-acc-title--sm");
  });
});
