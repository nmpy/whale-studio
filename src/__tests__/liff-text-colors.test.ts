// src/__tests__/liff-text-colors.test.ts
//
// 見出し / 本文の文字色 (settings_json.heading_color / body_color)。
//
// 仕組み: root の class が `--liff-heading-color` / `--liff-body-color` トークンを
// 差し替え、renderer 側が `var(--liff-*-color, var(--liff-primary-text))` で読む。
//
// 最重要の不変条件:
//   1. 未設定 / "default" は class を出さない = 既存ページの計算値と完全に一致
//   2. renderer 側の fallback が --liff-primary-text = 従来の文字色

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveHeadingColor,
  headingColorClass,
  resolveBodyColor,
  bodyColorClass,
  liffRootClass,
} from "@/components/liff/liff-style-helpers";
import { liffPageConfigSettingsSchema } from "@/lib/validations";
import type { LiffPageConfigSettings } from "@/types";

const S = (o: Record<string, unknown>): LiffPageConfigSettings => o as LiffPageConfigSettings;
const CSS = readFileSync(join(process.cwd(), "src/app/liff/liff-font.css"), "utf8");
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("後方互換 — 未設定ページは従来のまま", () => {
  it("未設定 / default / 不正値では root class が増えない", () => {
    expect(liffRootClass(undefined)).toBe("");
    expect(liffRootClass({})).toBe("");
    expect(liffRootClass(S({ heading_color: "default", body_color: "default" }))).toBe("");
    expect(liffRootClass(S({ heading_color: "blue" }))).toBe("");
    expect(liffRootClass(S({ body_color: null }))).toBe("");
  });

  it("トークンの既定値が --liff-primary-text = 従来の文字色", () => {
    expect(CSS).toContain("--liff-heading-color: var(--liff-primary-text)");
    expect(CSS).toContain("--liff-body-color:    var(--liff-primary-text)");
  });

  // 本文 / 見出しを描く renderer が 1 つでもトークンを読み忘れると、そのブロックだけ
  // 色が変わらない（実際 FreeTextBlock の読み忘れをブラウザ実測で発見した）。
  // 「--liff-primary-text を直接読んでいる本文 / 見出しブロックが無いこと」を固定する。
  it("本文・見出しを描くブロック renderer がトークンを読み忘れていない", () => {
    const files = {
      "renderers/FreeTextBlock.tsx": ["--liff-body-color", "--liff-heading-color"],
      "renderers/TextBlock.tsx":     ["--liff-body-color"],
      "renderers/HeadingBlock.tsx":  ["--liff-heading-color"],
      "renderers/AccordionBlock.tsx": ["--liff-body-color", "--liff-heading-color"],
    };
    for (const [f, tokens] of Object.entries(files)) {
      const src = read(`src/components/liff/${f}`);
      for (const t of tokens) expect(src, `${f} が ${t} を読んでいない`).toContain(t);
    }
  });

  // renderer が fallback を落とすと、class の付かないページまで色が消える。
  it("renderer 側は必ず --liff-primary-text へフォールバックしている", () => {
    const heading = read("src/components/liff/renderers/HeadingBlock.tsx");
    const text = read("src/components/liff/renderers/TextBlock.tsx");
    const acc = read("src/components/liff/renderers/AccordionBlock.tsx");
    expect(heading).toContain("var(--liff-heading-color,var(--liff-primary-text))");
    expect(text).toContain("var(--liff-body-color,var(--liff-primary-text))");
    const free = read("src/components/liff/renderers/FreeTextBlock.tsx");
    expect(free).toContain("var(--liff-body-color,var(--liff-primary-text))");
    expect(free).toContain("var(--liff-heading-color,var(--liff-primary-text))");
    expect(acc).toContain("var(--liff-heading-color,var(--liff-primary-text))");
    expect(acc).toContain("var(--liff-body-color,var(--liff-primary-text))");
    expect(CSS).toContain(".liff-font .liff-h-title { color: var(--liff-heading-color, var(--liff-primary-text)); }");
  });
});

describe("見出しの色（heading_color）", () => {
  it("未設定・不正値は default", () => {
    expect(resolveHeadingColor(undefined)).toBe("default");
    expect(resolveHeadingColor(S({ heading_color: "blue" }))).toBe("default");
  });

  it("default 以外だけ class が付く", () => {
    expect(headingColorClass("default")).toBe("");
    expect(headingColorClass("white")).toBe("liff-heading-color--white");
    expect(headingColorClass("red")).toBe("liff-heading-color--red");
    expect(headingColorClass("green")).toBe("liff-heading-color--green");
  });
});

describe("本文の色（body_color）", () => {
  it("未設定・不正値は default", () => {
    expect(resolveBodyColor(undefined)).toBe("default");
    expect(resolveBodyColor(S({ body_color: 0 }))).toBe("default");
  });

  it("default 以外だけ class が付く", () => {
    expect(bodyColorClass("default")).toBe("");
    expect(bodyColorClass("white")).toBe("liff-body-color--white");
    expect(bodyColorClass("red")).toBe("liff-body-color--red");
    expect(bodyColorClass("green")).toBe("liff-body-color--green");
  });
});

describe("2 つは独立している", () => {
  it("片方だけ / 両方 を別の色で指定できる", () => {
    expect(liffRootClass(S({ heading_color: "red" }))).toBe("liff-heading-color--red");
    expect(liffRootClass(S({ body_color: "green" }))).toBe("liff-body-color--green");
    const both = liffRootClass(S({ heading_color: "white", body_color: "green" }));
    expect(both).toContain("liff-heading-color--white");
    expect(both).toContain("liff-body-color--green");
  });

  it("class は必ず 6 種すべて CSS に定義されている", () => {
    for (const c of ["white", "red", "green"]) {
      expect(CSS).toContain(`.liff-heading-color--${c} { --liff-heading-color: var(--liff-text-${c}); }`);
      expect(CSS).toContain(`.liff-body-color--${c} { --liff-body-color: var(--liff-text-${c}); }`);
    }
  });
});

// 赤 / 緑は地色の明暗でコントラストが破綻するため、暗色モードでだけ明るい値に差し替える。
describe("暗色モードでの文字色パレット読み替え", () => {
  it("暗色モード（dark / terminal / dot）では赤・緑が明るい値になる", () => {
    // 暗色モードが増えたらこのセレクタ群にも追加する（dot は #636 で追加済み）。
    const rule = CSS.match(/\.liff-color-mode-dark,[\s\S]*?\{[^}]*--liff-text-red[^}]*\}/)![0];
    expect(rule).toContain(".liff-color-mode-terminal");
    expect(rule).toContain("--liff-text-red:   #FF6B6B");
    expect(rule).toContain("--liff-text-green: #3BE07A");
  });

  // system を素で当てると OS が light のときまで暗色用の色になってしまう。
  it("system の読み替えは @media (prefers-color-scheme: dark) の中だけにある", () => {
    const media = CSS.slice(CSS.indexOf("@media (prefers-color-scheme: dark) {", CSS.indexOf(".liff-color-mode-terminal .bg-white")));
    expect(media).toContain(".liff-color-mode-system {");
    expect(media).toContain("--liff-text-red:   #FF6B6B");

    // @media の外に .liff-color-mode-system のパレット定義が無いこと
    const outside = CSS.split("@media")[0];
    expect(outside).not.toContain(".liff-color-mode-system {");
  });

  it("明るい地色のモード（light / sepia / bordeaux）には当てていない", () => {
    for (const m of ["sepia", "bordeaux"]) {
      const rule = CSS.match(new RegExp(`\\.liff-color-mode-${m} \\{[^}]*\\}`))?.[0] ?? "";
      expect(rule).not.toContain("--liff-text-red");
    }
  });
});

describe("保存バリデーション", () => {
  it("4 値だけ通る", () => {
    for (const k of ["heading_color", "body_color"]) {
      for (const v of ["default", "white", "red", "green"]) {
        expect(liffPageConfigSettingsSchema.safeParse({ [k]: v }).success).toBe(true);
      }
      expect(liffPageConfigSettingsSchema.safeParse({ [k]: "blue" }).success).toBe(false);
    }
    expect(liffPageConfigSettingsSchema.safeParse({}).success).toBe(true);
  });
});
