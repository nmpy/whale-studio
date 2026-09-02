// src/__tests__/liff-dot-theme.test.ts
//
// ドット（8bit / レトロゲーム風）の 2 設定:
//   - font_theme = "dot"  … DotGothic16（OS 内蔵の代替が無いので webfont 必須）
//   - color_mode = "dot"  … 純黒 × 白。走査線などの装飾を持たない素の黒地
//
// 対で使う想定だが独立して選べる。
// 最重要の不変条件: 既存の他テーマ / 他モードの計算値を 1px も変えないこと。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveFontTheme,
  fontThemeClass,
  resolveColorMode,
  colorModeClass,
  liffRootClass,
} from "@/components/liff/liff-style-helpers";
import { liffPageConfigSettingsSchema } from "@/lib/validations";
import type { LiffPageConfigSettings } from "@/types";

const S = (o: Record<string, unknown>): LiffPageConfigSettings => o as LiffPageConfigSettings;
const CSS = readFileSync(join(process.cwd(), "src/app/liff/liff-font.css"), "utf8");

function ruleBody(sel: string): string {
  const i = CSS.indexOf(sel);
  expect(i, `${sel} が CSS に無い`).toBeGreaterThan(-1);
  return CSS.slice(CSS.indexOf("{", i) + 1, CSS.indexOf("}", i));
}

describe("後方互換 — 既存ページは不変", () => {
  it("未設定ページの root class は空文字のまま", () => {
    expect(liffRootClass(undefined)).toBe("");
    expect(liffRootClass({})).toBe("");
  });

  it("dot を知らない不正値は従来どおり既定へフォールバックする", () => {
    expect(resolveFontTheme(S({ font_theme: "dotty" }))).toBe("default");
    expect(resolveColorMode(S({ color_mode: "dotty" }))).toBe("light");
  });
});

describe("font_theme = dot", () => {
  it("解決と class", () => {
    expect(resolveFontTheme(S({ font_theme: "dot" }))).toBe("dot");
    expect(fontThemeClass("dot")).toBe("liff-font-theme--dot");
    expect(liffRootClass(S({ font_theme: "dot" }))).toBe("liff-font-theme--dot");
  });

  it("font stack の先頭が DotGothic16（同梱 webfont を最優先）", () => {
    const body = ruleBody(".liff-font-theme--dot {");
    const stack = body.replace(/\s+/g, " ");
    expect(stack.indexOf('"DotGothic16"')).toBeGreaterThan(-1);
    // fallback は等幅系（ドット字形が無い環境でも字幅が崩れにくい）
    expect(stack).toContain("monospace");
    // 先頭が DotGothic16 であること
    expect(stack.trim().indexOf('"DotGothic16"')).toBeLessThan(stack.indexOf("monospace"));
  });

  it("webfont は dot を選んだページだけが読む（遅延ロード）", () => {
    const src = readFileSync(join(process.cwd(), "src/components/liff/fonts/LiffFontThemeAssets.tsx"), "utf8");
    expect(src).toContain('import("./LiffFontDot")');
    expect(src).toContain('theme === "dot"');
    // ssr:false の dynamic 経由（= 他テーマのバンドルに乗らない）
    const line = src.split("\n").find((l) => l.includes("const LiffFontDot"))!;
    expect(line).toContain("dynamic(");
    expect(line).toContain("ssr: false");
  });
});

describe("color_mode = dot", () => {
  it("解決と class", () => {
    expect(resolveColorMode(S({ color_mode: "dot" }))).toBe("dot");
    expect(colorModeClass("dot")).toBe("liff-color-mode-dot");
    expect(liffRootClass(S({ color_mode: "dot" }))).toBe("liff-color-mode-dot");
  });

  it("純黒 × 白のパレット", () => {
    const body = ruleBody(".liff-color-mode-dot {");
    expect(body).toContain("color-scheme: dark");
    expect(body).toContain("--liff-background:        #000000");
    expect(body).toContain("--liff-primary-text:      #FFFFFF");
  });

  // 暗色地では既定の濃い赤 / 緑が沈むため、明るい値に差し替わる必要がある。
  it("文字色パレット（赤 / 緑）の暗色読み替え対象に入っている", () => {
    const rule = CSS.match(/\.liff-color-mode-dark,\s*\n\.liff-color-mode-terminal,\s*\n\.liff-color-mode-dot \{[^}]*\}/)![0];
    expect(rule).toContain("--liff-text-red:   #FF6B6B");
    expect(rule).toContain("--liff-text-green: #3BE07A");
  });

  // terminal に当てている Tailwind 上書きは dot にも要る（当て漏れると白背景が残る）。
  //
  // 移植時に実際に 3 回落とし穴を踏んだので、代表 3 つの抜き取りではなく
  // 「terminal にあって dot に無いセレクタ」を全数で 0 件にする形で固定する。
  // 疑似クラス (:focus / ::placeholder) や、複数セレクタ群の最終行が
  // 1 行完結ルールになっている箇所を取りこぼしやすい。
  it("terminal 用セレクタは 1 つ残らず dot にも用意されている（全数）", () => {
    const pick = (mode: string) =>
      new Set(
        [...CSS.matchAll(new RegExp(`\\.liff-(?:font\\.)?liff-color-mode-${mode}[^,{]*`, "g"))]
          .map((m) => m[0].replace(`liff-color-mode-${mode}`, "MODE").trim())
          // パレット定義（子孫セレクタを持たない）は各モード固有なので対象外
          .filter((x) => x !== ".MODE" && x !== ".liff-font.MODE"),
      );
    const missing = [...pick("terminal")].filter((x) => !pick("dot").has(x));
    expect(missing, `dot に当て漏れ: ${missing.join(" / ")}`).toEqual([]);
  });

  it("代表的な上書きが dot に当たっている", () => {
    for (const sel of [".bg-white", ".text-gray-900", ".border-gray-200"]) {
      const t = CSS.includes(`.liff-color-mode-terminal ${sel}`);
      const d = CSS.includes(`.liff-color-mode-dot ${sel}`);
      expect(t, `terminal ${sel}`).toBe(true);
      expect(d, `dot ${sel} が当て漏れ`).toBe(true);
    }
    // 入力欄も同様
    expect(CSS).toContain(".liff-font.liff-color-mode-dot input");
  });
});

describe("2 つは独立して選べる", () => {
  it("フォントだけ / 配色だけ / 両方", () => {
    expect(liffRootClass(S({ font_theme: "dot" }))).toBe("liff-font-theme--dot");
    expect(liffRootClass(S({ color_mode: "dot" }))).toBe("liff-color-mode-dot");
    const both = liffRootClass(S({ font_theme: "dot", color_mode: "dot" }));
    expect(both).toContain("liff-font-theme--dot");
    expect(both).toContain("liff-color-mode-dot");
  });

  it("ドット配色 + 文字色（#634）を組み合わせられる", () => {
    const cls = liffRootClass(S({ color_mode: "dot", heading_color: "green", body_color: "white" }));
    expect(cls).toContain("liff-color-mode-dot");
    expect(cls).toContain("liff-heading-color--green");
    expect(cls).toContain("liff-body-color--white");
  });
});

describe("保存バリデーション", () => {
  it("dot が通り、未知値は弾く", () => {
    expect(liffPageConfigSettingsSchema.safeParse({ font_theme: "dot" }).success).toBe(true);
    expect(liffPageConfigSettingsSchema.safeParse({ color_mode: "dot" }).success).toBe(true);
    expect(liffPageConfigSettingsSchema.safeParse({ font_theme: "dotty" }).success).toBe(false);
    expect(liffPageConfigSettingsSchema.safeParse({ color_mode: "dotty" }).success).toBe(false);
  });
});
