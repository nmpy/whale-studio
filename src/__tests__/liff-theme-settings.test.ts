// src/__tests__/liff-theme-settings.test.ts
//
// LIFF のフォントテーマ (settings_json.font_theme) / カラーモード (settings_json.color_mode) の
// 解決ロジックと保存バリデーションのテスト。
//
// 最重要の不変条件:
//   「未設定 / 不正値のページは、従来とまったく同じ class（= 空文字）になる」
//   これが崩れると既存の全 LIFF ページの見た目が変わるため、ここを最初に固定する。

import { describe, it, expect } from "vitest";
import {
  resolveFontTheme,
  fontThemeClass,
  resolveColorMode,
  colorModeClass,
  liffRootClass,
} from "@/components/liff/liff-style-helpers";
import { liffPageConfigSettingsSchema } from "@/lib/validations";
import { LIFF_TEXT } from "@/components/liff/ui/tokens";
import type { LiffPageConfigSettings } from "@/types";

const S = (o: Record<string, unknown>): LiffPageConfigSettings => o as LiffPageConfigSettings;

describe("resolveFontTheme — 既定値とフォールバック", () => {
  it("未設定 (undefined) は default", () => {
    expect(resolveFontTheme(undefined)).toBe("default");
  });

  it("空の settings は default", () => {
    expect(resolveFontTheme({})).toBe("default");
  });

  it("font_theme が指定されていればそれを返す", () => {
    for (const t of ["default", "gothic", "rounded", "classic", "modern"] as const) {
      expect(resolveFontTheme(S({ font_theme: t }))).toBe(t);
    }
  });

  it("不正値の font_theme は default にフォールバックする", () => {
    expect(resolveFontTheme(S({ font_theme: "comic-sans" }))).toBe("default");
    expect(resolveFontTheme(S({ font_theme: 123 }))).toBe("default");
    expect(resolveFontTheme(S({ font_theme: null }))).toBe("default");
  });

  it("旧 font_preset は新テーマへマップされる（既存データ互換）", () => {
    expect(resolveFontTheme(S({ font_preset: "line_seed_jp" }))).toBe("default");
    expect(resolveFontTheme(S({ font_preset: "noto_sans_jp" }))).toBe("gothic");
    expect(resolveFontTheme(S({ font_preset: "serif" }))).toBe("classic");
    expect(resolveFontTheme(S({ font_preset: "system_sans" }))).toBe("modern");
  });

  it("最旧 font_family=mincho も classic へ辿り着く（2 段フォールバック）", () => {
    expect(resolveFontTheme(S({ font_family: "mincho" }))).toBe("classic");
    expect(resolveFontTheme(S({ font_family: "gothic" }))).toBe("default");
  });

  it("font_theme は旧 font_preset より優先される", () => {
    expect(resolveFontTheme(S({ font_theme: "rounded", font_preset: "serif" }))).toBe("rounded");
  });
});

describe("fontThemeClass", () => {
  it("default は空文字（= 既存ページの DOM を変えない）", () => {
    expect(fontThemeClass("default")).toBe("");
  });

  it("それ以外は専用クラスを返す", () => {
    expect(fontThemeClass("gothic")).toBe("liff-font-theme--gothic");
    expect(fontThemeClass("rounded")).toBe("liff-font-theme--rounded");
    expect(fontThemeClass("classic")).toBe("liff-font-theme--classic");
    expect(fontThemeClass("modern")).toBe("liff-font-theme--modern");
  });
});

describe("resolveColorMode — 既定値とフォールバック", () => {
  it("未設定 / 空 settings は light", () => {
    expect(resolveColorMode(undefined)).toBe("light");
    expect(resolveColorMode({})).toBe("light");
  });

  it("既知の値はそのまま返す", () => {
    for (const m of ["light", "dark", "system", "sepia", "bordeaux"] as const) {
      expect(resolveColorMode(S({ color_mode: m }))).toBe(m);
    }
  });

  it("不正値 / 未知値は light にフォールバックする", () => {
    expect(resolveColorMode(S({ color_mode: "neon" }))).toBe("light");
    expect(resolveColorMode(S({ color_mode: "" }))).toBe("light");
    expect(resolveColorMode(S({ color_mode: 1 }))).toBe("light");
    expect(resolveColorMode(S({ color_mode: null }))).toBe("light");
  });
});

describe("colorModeClass", () => {
  it("light は空文字（= 既存ページの DOM を変えない）", () => {
    expect(colorModeClass("light")).toBe("");
  });

  it("それ以外は専用クラスを返す", () => {
    expect(colorModeClass("dark")).toBe("liff-color-mode-dark");
    expect(colorModeClass("system")).toBe("liff-color-mode-system");
    expect(colorModeClass("sepia")).toBe("liff-color-mode-sepia");
    expect(colorModeClass("bordeaux")).toBe("liff-color-mode-bordeaux");
  });
});

describe("liffRootClass — renderer root に付く class", () => {
  it("未設定ページは空文字（後方互換の要）", () => {
    expect(liffRootClass(undefined)).toBe("");
    expect(liffRootClass({})).toBe("");
  });

  it("font_theme のみ指定", () => {
    expect(liffRootClass(S({ font_theme: "rounded" }))).toBe("liff-font-theme--rounded");
  });

  it("color_mode のみ指定", () => {
    expect(liffRootClass(S({ color_mode: "dark" }))).toBe("liff-color-mode-dark");
  });

  it("両方指定すると両方が付く", () => {
    const cls = liffRootClass(S({ font_theme: "classic", color_mode: "sepia" }));
    expect(cls.split(" ").sort()).toEqual(["liff-color-mode-sepia", "liff-font-theme--classic"]);
  });

  it("light + default は両方とも空なので空文字のまま", () => {
    expect(liffRootClass(S({ font_theme: "default", color_mode: "light" }))).toBe("");
  });

  it("旧 font_preset だけのページは対応する新クラスになる（表示は従来と同等）", () => {
    expect(liffRootClass(S({ font_preset: "serif" }))).toBe("liff-font-theme--classic");
    expect(liffRootClass(S({ font_preset: "line_seed_jp" }))).toBe("");
  });
});

describe("保存バリデーション (liffPageConfigSettingsSchema)", () => {
  it("正しい font_theme / color_mode は通る", () => {
    const r = liffPageConfigSettingsSchema.safeParse({ font_theme: "rounded", color_mode: "dark" });
    expect(r.success).toBe(true);
  });

  it("未指定でも通る（既存データ互換）", () => {
    expect(liffPageConfigSettingsSchema.safeParse({}).success).toBe(true);
  });

  it("不正な font_theme は弾く", () => {
    expect(liffPageConfigSettingsSchema.safeParse({ font_theme: "comic" }).success).toBe(false);
  });

  it("不正な color_mode は弾く", () => {
    expect(liffPageConfigSettingsSchema.safeParse({ color_mode: "neon" }).success).toBe(false);
  });

  it("旧 font_preset は引き続き保存できる（既存データを壊さない）", () => {
    expect(liffPageConfigSettingsSchema.safeParse({ font_preset: "serif" }).success).toBe(true);
  });

  it("他の settings と同時に保存しても影響しない", () => {
    const r = liffPageConfigSettingsSchema.safeParse({
      color_mode: "sepia",
      header_title: "ヒント",
      description_align: "left",
      faq_items: [{ question: "Q", answer: "A" }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.color_mode).toBe("sepia");
      expect(r.data.header_title).toBe("ヒント");
      expect(r.data.description_align).toBe("left");
    }
  });
});

// ── CSS 側の契約 ────────────────────────────────────────────────────────
// helpers が返す class 名と liff-font.css の定義がズレると「保存できるのに見た目が変わらない」
// という気付きにくい不具合になるため、CSS を実ファイルから読んで突き合わせる。

import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(join(process.cwd(), "src/app/liff/liff-font.css"), "utf8");

/** `selector { ... }` の中身（宣言リスト）を取り出す。ネストしたブロックが無い前提。 */
function ruleBody(css: string, selector: string): string | null {
  const i = css.indexOf(selector);
  if (i < 0) return null;
  const open = css.indexOf("{", i);
  const close = css.indexOf("}", open);
  if (open < 0 || close < 0) return null;
  return css.slice(open + 1, close);
}

/** 宣言リストを `プロパティ: 値` の正規化済み配列にする（コメント / 空白差を無視）。 */
function declarations(body: string): string[] {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";")
    .map((d) => d.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}


/** CSS 中の全 selector を列挙する（@media 等の at-rule prelude は除く）。 */
function selectorsOf(css: string): string[] {
  const out: string[] = [];
  for (const chunk of css.replace(/\/\*[\s\S]*?\*\//g, "").split("}")) {
    const i = chunk.indexOf("{");
    if (i < 0) continue;
    const sel = chunk.slice(0, i).trim().split("\n").map((l) => l.trim()).join(" ");
    if (!sel || sel.startsWith("@")) continue;
    out.push(sel);
  }
  return out;
}

/**
 * `.liff-color-mode-system` を含む rule のうち、
 * `@media (prefers-color-scheme: dark)` ブロックの外にあるものを返す。
 * 波括弧の深さを数えて media block の範囲を判定する。
 */
function systemRulesOutsideDarkMedia(css: string): string[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const bad: string[] = [];
  let depth = 0;
  let darkMediaDepth = -1;
  let buf = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      const prelude = buf.trim().replace(/\s+/g, " ");
      buf = "";
      depth++;
      if (prelude.startsWith("@media") && /prefers-color-scheme\s*:\s*dark/.test(prelude)) {
        if (darkMediaDepth < 0) darkMediaDepth = depth;
      } else if (prelude.includes("liff-color-mode-system") && darkMediaDepth < 0) {
        bad.push(prelude);
      }
    } else if (ch === "}") {
      if (darkMediaDepth === depth) darkMediaDepth = -1;
      depth--;
      buf = "";
    } else {
      buf += ch;
    }
  }
  return bad;
}

describe("liff-font.css の契約", () => {
  it("fontThemeClass が返す class がすべて CSS に定義されている", () => {
    for (const t of ["gothic", "rounded", "classic", "modern"] as const) {
      expect(CSS).toContain(`.${fontThemeClass(t)} {`);
    }
  });

  it("colorModeClass が返す class がすべて CSS に定義されている", () => {
    for (const m of ["dark", "sepia", "bordeaux"] as const) {
      expect(CSS).toContain(`.${colorModeClass(m)} {`);
    }
    // system は prefers-color-scheme: dark の media query 内にだけ定義される
    expect(CSS).toContain(".liff-color-mode-system {");
    expect(CSS).toContain("@media (prefers-color-scheme: dark)");
  });

  it("カラーモードのブロックは .liff-font より後ろにある（同 specificity で後勝ちさせるため）", () => {
    const base = CSS.indexOf(".liff-font {");
    expect(base).toBeGreaterThanOrEqual(0);
    for (const sel of [".liff-color-mode-dark {", ".liff-color-mode-sepia {", ".liff-color-mode-bordeaux {"]) {
      expect(CSS.indexOf(sel)).toBeGreaterThan(base);
    }
  });

  it("system(dark) の宣言は dark と完全に一致する（CSS に mixin が無いための重複を検出）", () => {
    const dark = ruleBody(CSS, ".liff-color-mode-dark {");
    const system = ruleBody(CSS, ".liff-color-mode-system {");
    expect(dark).not.toBeNull();
    expect(system).not.toBeNull();
    expect(declarations(system!)).toEqual(declarations(dark!));
  });

  // ── F1 回帰テスト ──────────────────────────────────────────────
  // `.liff-color-mode-system` を含む rule が 1 つでも
  // @media (prefers-color-scheme: dark) の外にあると、OS が light のときにも発火し
  // 「system + OS light」が「light」と一致しなくなる。CSS を構文的に走査して検出する。
  it("system 用の rule は 1 つ残らず prefers-color-scheme: dark の中にある", () => {
    const outside = systemRulesOutsideDarkMedia(CSS);
    expect(outside).toEqual([]);
  });

  it("dark / sepia のセーフティネットは system と混ぜて宣言されていない", () => {
    // 同じ selector list に system を混ぜると、media query で切り分けられなくなる。
    for (const sel of selectorsOf(CSS)) {
      if (!sel.includes("liff-color-mode-system")) continue;
      expect(sel.includes("liff-color-mode-dark") || sel.includes("liff-color-mode-sepia")).toBe(false);
    }
  });

  it("フォントテーマの webfont は layout.tsx で常時 import されていない（遅延ロード）", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/liff/layout.tsx"), "utf8");
    expect(layout).not.toContain("m-plus-rounded-1c");
    expect(layout).not.toContain("noto-serif-jp");
    // 既定フォントは従来どおり常時ロードする
    expect(layout).toContain("line-seed-jp");
    expect(layout).toContain("noto-sans-jp");

    const preview = readFileSync(join(process.cwd(), "src/components/liff/LiffPreview.tsx"), "utf8");
    expect(preview).not.toContain("m-plus-rounded-1c");
    expect(preview).not.toContain("noto-serif-jp");
  });

  it("rounded / classic の webfont は専用の遅延ロード component だけが import する", () => {
    const rounded = readFileSync(join(process.cwd(), "src/components/liff/fonts/LiffFontRounded.tsx"), "utf8");
    const classic = readFileSync(join(process.cwd(), "src/components/liff/fonts/LiffFontClassic.tsx"), "utf8");
    expect(rounded).toContain("@fontsource/m-plus-rounded-1c/400.css");
    expect(rounded).toContain("@fontsource/m-plus-rounded-1c/700.css");
    expect(classic).toContain("@fontsource/noto-serif-jp/400.css");
    expect(classic).toContain("@fontsource/noto-serif-jp/700.css");
  });

  it("rounded の font stack は同梱フォントを先頭に置く（端末間で字形を揃えるため）", () => {
    const decls = declarations(ruleBody(CSS, ".liff-font-theme--rounded {")!);
    const stack = decls[0].replace(/\s+/g, " ");
    const mplus = stack.indexOf('"M PLUS Rounded 1c"');
    const hiragino = stack.indexOf('"Hiragino Maru Gothic ProN"');
    expect(mplus).toBeGreaterThan(-1);
    expect(hiragino).toBeGreaterThan(-1);
    expect(mplus).toBeLessThan(hiragino);
  });

  it("header h1 の reset 値は LIFF_TEXT.pageTitle と一致している（ドリフト防止）", () => {
    // globals.css の `header h1 { font-size:15px; font-weight:800 }` が unlayered で漏れるため、
    // LIFF スコープでは utility と同じ値を CSS 側にも明示している。両者がズレると見出しが崩れる。
    const decls = declarations(ruleBody(CSS, ".liff-font header h1 {")!);
    const size = decls.find((d) => d.startsWith("font-size:"))!.split(":")[1].trim();
    const weight = decls.find((d) => d.startsWith("font-weight:"))!.split(":")[1].trim();

    const px = LIFF_TEXT.pageTitle.match(/text-\[(\d+)px\]/)![1];
    expect(size).toBe(`${px}px`);

    const TAILWIND_WEIGHT: Record<string, string> = {
      "font-normal": "400", "font-medium": "500", "font-semibold": "600", "font-bold": "700",
    };
    const cls = Object.keys(TAILWIND_WEIGHT).find((c) => LIFF_TEXT.pageTitle.includes(c))!;
    expect(weight).toBe(TAILWIND_WEIGHT[cls]);
  });

  it("globals.css の header 漏れ対策は LIFF スコープ内に閉じている", () => {
    expect(CSS).toContain(".liff-font header {");
    // `header { … }` のような素の element selector を足していないこと
    for (const sel of selectorsOf(CSS)) {
      if (/(^|,)\s*header\b/.test(sel)) throw new Error(`LIFF スコープ外の header selector: ${sel}`);
    }
  });

  it("暗色モードは色トークンだけを上書きし、レイアウト系トークンには触れていない", () => {
    const dark = declarations(ruleBody(CSS, ".liff-color-mode-dark {")!);
    const forbidden = ["--liff-gutter", "--liff-button-height", "--liff-card-radius", "--liff-ui-card-radius", "--liff-font-stack"];
    for (const prop of forbidden) {
      expect(dark.some((d) => d.startsWith(`${prop}:`))).toBe(false);
    }
  });

  it("フォントテーマは --liff-font-stack だけを上書きし、色には触れていない", () => {
    for (const t of ["gothic", "rounded", "classic", "modern"] as const) {
      const decls = declarations(ruleBody(CSS, `.${fontThemeClass(t)} {`)!);
      expect(decls.length).toBe(1);
      expect(decls[0].startsWith("--liff-font-stack:")).toBe(true);
    }
  });
});
