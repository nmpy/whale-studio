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
  resolveFontScale,
  fontScaleClass,
  resolveFontWeightLevel,
  fontWeightLevelClass,
  resolveHeadingScale,
  headingScaleClass,
  resolveHeadingWeightLevel,
  headingWeightLevelClass,
  resolveLayoutDensity,
  layoutDensityClass,
  liffRootClass,
} from "@/components/liff/liff-style-helpers";
import { headingSizeClass } from "@/components/liff/liff-style-helpers";
import { accordionDepthStyle } from "@/components/liff/accordion-depth-style";
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

import { readFileSync, readdirSync } from "node:fs";
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
    for (const m of ["dark", "sepia", "bordeaux", "terminal"] as const) {
      expect(CSS).toContain(`.${colorModeClass(m)} {`);
    }
    // system は prefers-color-scheme: dark の media query 内にだけ定義される
    expect(CSS).toContain(".liff-color-mode-system {");
    expect(CSS).toContain("@media (prefers-color-scheme: dark)");
  });

  it("カラーモードのブロックは .liff-font より後ろにある（同 specificity で後勝ちさせるため）", () => {
    const base = CSS.indexOf(".liff-font {");
    expect(base).toBeGreaterThanOrEqual(0);
    for (const sel of [".liff-color-mode-dark {", ".liff-color-mode-sepia {", ".liff-color-mode-bordeaux {", ".liff-color-mode-terminal {"]) {
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
    const forbidden = ["--liff-gutter", "--liff-button-height", "--liff-card-radius", "--liff-ui-card-radius", "--liff-font-stack"];
    for (const sel of [".liff-color-mode-dark {", ".liff-color-mode-terminal {"]) {
      const decls = declarations(ruleBody(CSS, sel)!);
      for (const prop of forbidden) {
        expect(decls.some((d) => d.startsWith(`${prop}:`))).toBe(false);
      }
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


// ════════════════════════════════════════════════════════════════════════
// ターミナル（黒 × 電子グリーン）/ 文字サイズ / 文字の太さ
// ════════════════════════════════════════════════════════════════════════

describe("terminal カラーモード", () => {
  it("resolveColorMode / colorModeClass が terminal を返す", () => {
    expect(resolveColorMode(S({ color_mode: "terminal" }))).toBe("terminal");
    expect(colorModeClass("terminal")).toBe("liff-color-mode-terminal");
  });

  it("保存バリデーションを通る", () => {
    expect(liffPageConfigSettingsSchema.safeParse({ color_mode: "terminal" }).success).toBe(true);
  });

  it("暗色セーフティネット（bg-white / text-gray-* / 入力欄）の対象に入っている", () => {
    // 暗い地色で Tailwind 直書きの白 / グレーが取り残されると本文が読めなくなる。
    const sels = selectorsOf(CSS).filter((s) => s.includes("liff-color-mode-terminal"));
    for (const needle of [".bg-white", ".text-gray-700", ".border-gray-200", "input", "textarea"]) {
      expect(sels.some((s) => s.includes(needle))).toBe(true);
    }
  });

  it("背景レイヤー（走査線 / 格子）はトークン経由で、.liff-font が参照している", () => {
    const decls = declarations(ruleBody(CSS, ".liff-color-mode-terminal {")!);
    expect(decls.some((d) => d.startsWith("--liff-backdrop-image:"))).toBe(true);
    // 参照側: 既定は none = 他モードの見た目に影響しない
    expect(CSS).toContain("background-image: var(--liff-backdrop-image, none);");
  });

  it("本文は白・罫線は緑・カード外周線は出さない（実機フィードバック反映）", () => {
    const decls = declarations(ruleBody(CSS, ".liff-color-mode-terminal {")!);
    expect(decls).toContain("--liff-primary-text: #FFFFFF");
    expect(decls).toContain("--liff-ui-card-border: transparent");
    // 罫線は装飾としてグリーンを出す（地色に沈む暗さにしない）
    const border = decls.find((d) => d.startsWith("--liff-border:"))!;
    expect(border).toBe("--liff-border: #2C6B49");
  });

  it("資料集シートの外周線はトークン経由（暗色テーマで白い線が残らない）", () => {
    const src = readFileSync(join(process.cwd(), "src/components/liff/LiffRenderer.tsx"), "utf8");
    expect(src).not.toContain("border-[#eef2f5]");
    expect(src).toContain("border-[color:var(--liff-ui-card-border,#eef2f5)]");
  });

  it("塗り面の文字色（--liff-on-accent）を明示している（明るい緑に白文字を載せない）", () => {
    const decls = declarations(ruleBody(CSS, ".liff-color-mode-terminal {")!);
    expect(decls.some((d) => d.startsWith("--liff-on-accent:"))).toBe(true);
  });
});

describe("resolveFontScale / fontScaleClass", () => {
  it("未設定・空・不正値はすべて md（= 現行と同じ大きさ）", () => {
    expect(resolveFontScale(undefined)).toBe("md");
    expect(resolveFontScale({})).toBe("md");
    expect(resolveFontScale(S({ font_scale: "huge" }))).toBe("md");
    expect(resolveFontScale(S({ font_scale: 2 }))).toBe("md");
    expect(resolveFontScale(S({ font_scale: null }))).toBe("md");
  });

  it("指定した値をそのまま返す", () => {
    for (const v of ["sm", "md", "lg", "xl"] as const) {
      expect(resolveFontScale(S({ font_scale: v }))).toBe(v);
    }
  });

  it("md は class なし（既存 DOM と 1 文字も変わらない）", () => {
    expect(fontScaleClass("md")).toBe("");
    expect(fontScaleClass("sm")).toBe("liff-font-size--sm");
    expect(fontScaleClass("lg")).toBe("liff-font-size--lg");
    expect(fontScaleClass("xl")).toBe("liff-font-size--xl");
  });

  it("保存バリデーション: 正しい値は通り、不正値は弾く", () => {
    expect(liffPageConfigSettingsSchema.safeParse({ font_scale: "lg" }).success).toBe(true);
    expect(liffPageConfigSettingsSchema.safeParse({ font_scale: "huge" }).success).toBe(false);
  });
});

describe("resolveFontWeightLevel / fontWeightLevelClass", () => {
  it("未設定・空・不正値はすべて normal（= 現行と同じ太さ）", () => {
    expect(resolveFontWeightLevel(undefined)).toBe("normal");
    expect(resolveFontWeightLevel({})).toBe("normal");
    expect(resolveFontWeightLevel(S({ font_weight_level: "black" }))).toBe("normal");
    expect(resolveFontWeightLevel(S({ font_weight_level: 700 }))).toBe("normal");
  });

  it("normal は class なし", () => {
    expect(fontWeightLevelClass("normal")).toBe("");
    expect(fontWeightLevelClass("light")).toBe("liff-font-weight--light");
    expect(fontWeightLevelClass("bold")).toBe("liff-font-weight--bold");
  });

  it("ブロック単位の font_weight とは独立（別キー）", () => {
    // TextSettings.font_weight は "medium" 等を取る別概念。混線していないことを固定する。
    expect(resolveFontWeightLevel(S({ font_weight: "medium" }))).toBe("normal");
  });

  it("保存バリデーション: 正しい値は通り、不正値は弾く", () => {
    expect(liffPageConfigSettingsSchema.safeParse({ font_weight_level: "bold" }).success).toBe(true);
    expect(liffPageConfigSettingsSchema.safeParse({ font_weight_level: "black" }).success).toBe(false);
  });
});

describe("liffRootClass — サイズ / 太さの合成", () => {
  it("すべて既定なら空文字（= 既存ページの DOM は変わらない）", () => {
    expect(liffRootClass(undefined)).toBe("");
    expect(liffRootClass(S({ font_scale: "md", font_weight_level: "normal" }))).toBe("");
  });

  it("4 つの設定が同時に載る", () => {
    const cls = liffRootClass(S({
      font_theme: "gothic", color_mode: "terminal", font_scale: "lg", font_weight_level: "bold",
    }));
    expect(cls).toContain("liff-font-theme--gothic");
    expect(cls).toContain("liff-color-mode-terminal");
    expect(cls).toContain("liff-font-size--lg");
    expect(cls).toContain("liff-font-weight--bold");
  });
});

/** ディレクトリを再帰的に辿って .ts / .tsx を列挙する（px ドリフト検出用）。 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

/** 「文字サイズ / 文字の太さ」セクション以降の CSS（既定値ブロックの scoping 用）。 */
const SIZE_SECTION = CSS.slice(CSS.indexOf("文字サイズ (settings_json.font_scale)"));

describe("liff-font.css の契約 — サイズ / 太さ", () => {
  it("fontScaleClass / fontWeightLevelClass が返す class がすべて CSS に定義されている", () => {
    for (const v of ["sm", "lg", "xl"] as const) expect(CSS).toContain(`.${fontScaleClass(v)} {`);
    for (const v of ["light", "bold"] as const) expect(CSS).toContain(`.${fontWeightLevelClass(v)} {`);
  });

  it("既定値は倍率 1・Tailwind と同じ font-weight（未設定ページが変わらない根拠）", () => {
    const base = declarations(ruleBody(SIZE_SECTION, ".liff-font {")!);
    expect(base).toContain("--liff-fs-mul: 1");
    for (const [prop, w] of [
      ["--liff-fw-normal", "400"], ["--liff-fw-medium", "500"],
      ["--liff-fw-semibold", "600"], ["--liff-fw-bold", "700"],
    ] as const) {
      // 既定ブロック（.liff-font）に Tailwind と同値で入っていること
      expect(base).toContain(`${prop}: ${w}`);
    }
  });

  it("サイズ / 太さの class は .liff-font より後ろにある（同 specificity で後勝ちさせるため）", () => {
    const base = CSS.indexOf(".liff-font {");
    for (const sel of [
      ".liff-font-size--sm {", ".liff-font-size--lg {", ".liff-font-size--xl {",
      ".liff-font-weight--light {", ".liff-font-weight--bold {",
    ]) {
      expect(CSS.indexOf(sel)).toBeGreaterThan(base);
    }
  });

  it("Tailwind の font-* utility をトークン経由に読み替えている", () => {
    for (const [cls, token] of [
      ["font-normal", "--liff-fw-normal"], ["font-medium", "--liff-fw-medium"],
      ["font-semibold", "--liff-fw-semibold"], ["font-bold", "--liff-fw-bold"],
    ] as const) {
      expect(CSS).toContain(`.liff-font .${cls}`);
      expect(new RegExp(`font-weight: var\\(${token}[,)]`).test(CSS)).toBe(true);
    }
  });

  it("LIFF 配下で使われている text-[Npx] は 1 つ残らず倍率 calc に読み替えられている", () => {
    // ドリフト検出: 新しい px を renderer に書いたのに CSS へ追加し忘れると、
    // その文字だけ拡縮に追従しない（見出しと本文の比率が崩れる）。
    const used = new Set<string>();
    for (const dir of ["src/components/liff", "src/app/liff"]) {
      for (const f of walk(join(process.cwd(), dir))) {
        const src = readFileSync(f, "utf8");
        for (const m of src.matchAll(/text-\[([0-9.]+)px\]/g)) used.add(m[1]);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    const missing = [...used].filter((px) => {
      const sel = `.liff-font .text-\\[${px.replace(".", "\\.")}px\\]`;
      return !CSS.includes(sel) || !CSS.includes(`calc(${px}px * var(--liff-fs-mul, 1))`);
    });
    expect(missing).toEqual([]);
  });

  it("Tailwind v4 の名前付きサイズ (text-sm 等) も倍率に追従する", () => {
    for (const t of ["--text-xs", "--text-sm", "--text-base", "--text-lg", "--text-xl", "--text-3xl"]) {
      expect(new RegExp(`${t}:\\s*calc\\(`).test(CSS)).toBe(true);
    }
  });
});

describe("見出し系 (heading_scale / heading_weight) — 本文系と分けて指定できる", () => {
  it("未設定なら本文系にフォールバックする（見出し/本文を分ける前と同じ見た目）", () => {
    expect(resolveHeadingScale(undefined)).toBe("md");
    expect(resolveHeadingScale(S({ font_scale: "xl" }))).toBe("xl");
    expect(resolveHeadingWeightLevel(S({ font_weight_level: "bold" }))).toBe("bold");
  });

  it("指定があれば本文系より優先される", () => {
    expect(resolveHeadingScale(S({ font_scale: "xl", heading_scale: "sm" }))).toBe("sm");
    expect(resolveHeadingWeightLevel(S({ font_weight_level: "bold", heading_weight: "light" }))).toBe("light");
  });

  it("不正値は本文系 → 既定へ落ちる", () => {
    expect(resolveHeadingScale(S({ heading_scale: "giant" }))).toBe("md");
    expect(resolveHeadingWeightLevel(S({ heading_weight: 900 }))).toBe("normal");
  });

  it("md / normal は class なし（既存 DOM 不変）", () => {
    expect(headingScaleClass("md")).toBe("");
    expect(headingWeightLevelClass("normal")).toBe("");
    expect(liffRootClass(S({ heading_scale: "md", heading_weight: "normal" }))).toBe("");
  });

  it("root class に本文系と見出し系が別々に載る", () => {
    const cls = liffRootClass(S({ font_scale: "sm", heading_scale: "xl", heading_weight: "bold" }));
    expect(cls).toContain("liff-font-size--sm");
    expect(cls).toContain("liff-heading-size--xl");
    expect(cls).toContain("liff-heading-weight--bold");
  });

  it("保存バリデーションを通る / 不正値は弾く", () => {
    expect(liffPageConfigSettingsSchema.safeParse({ heading_scale: "lg", heading_weight: "bold" }).success).toBe(true);
    expect(liffPageConfigSettingsSchema.safeParse({ heading_scale: "giant" }).success).toBe(false);
    expect(liffPageConfigSettingsSchema.safeParse({ heading_weight: "black" }).success).toBe(false);
  });
});

describe("liff-font.css の契約 — 見出し系", () => {
  it("マーカー class の px / 太さは renderer 側の現行値と一致している（ドリフト防止）", () => {
    // ページタイトル: LiffSinglePageRenderer の h2
    const page = readFileSync(join(process.cwd(), "src/components/liff/LiffSinglePageRenderer.tsx"), "utf8");
    const titleCls = page.match(/liff-h-title[^"]*"/)![0];
    expect(titleCls).toContain("text-[20px]");
    expect(titleCls).toContain("font-bold");
    // ページタイトルは title_scale で切り出せるため、内側にもう 1 段 var を挟む。
    // 未設定なら --liff-title-mul は未定義 ⇒ --liff-heading-mul にフォールバックする。
    expect(CSS).toContain(".liff-font .liff-h-title   { font-size: calc(20px * var(--liff-title-mul, var(--liff-heading-mul, 1))); font-weight: var(--liff-heading-fw, 700); }");

    // アコーディオン見出し: accordion-depth-style の title
    for (const [depth, px, weight] of [[1, "16", "700"], [2, "15", "600"], [3, "14", "600"]] as const) {
      const style = accordionDepthStyle(depth);
      expect(style.title).toContain(`liff-h-acc--${depth}`);
      expect(style.title).toContain(`text-[${px}px]`);
      const rule = ruleBody(CSS, `.liff-font .liff-h-acc--${depth}`)!;
      // アコーディオン見出しだけは accordion_title_scale で切り出せるため、内側にもう 1 段
      // var を挟む。未設定なら --liff-acc-title-mul は未定義 ⇒ --liff-heading-mul に
      // フォールバックするので、既存ページの計算値は従来と同じ。
      expect(rule).toContain(`calc(${px}px * var(--liff-acc-title-mul, var(--liff-heading-mul, 1)))`);
      expect(rule).toContain(weight);
    }

    // 見出しブロック: headingSizeClass の px と一致
    for (const level of [1, 2, 3, 4, 5] as const) {
      const px = headingSizeClass(level).match(/text-\[(\d+)px\]/)![1];
      const rule = ruleBody(CSS, `.liff-font .liff-h-blk--${level}`)!;
      expect(rule).toContain(`calc(${px}px * var(--liff-heading-mul, 1))`);
    }
  });

  it("見出し系の rule は本文系の px 読み替えより後ろにある（後勝ちで倍率が分かれる）", () => {
    expect(CSS.indexOf(".liff-font .liff-h-title")).toBeGreaterThan(CSS.indexOf(".liff-font .text-\\[14px\\]"));
  });

  it("headingScaleClass / headingWeightLevelClass が返す class がすべて CSS に定義されている", () => {
    for (const v of ["sm", "lg", "xl"] as const) expect(CSS).toContain(`.${headingScaleClass(v)} {`);
    for (const v of ["light", "bold"] as const) expect(CSS).toContain(`.${headingWeightLevelClass(v)} {`);
  });
});

describe("余白 (layout_density)", () => {
  it("未設定・不正値は normal（= 現行と同じ余白・class なし）", () => {
    expect(resolveLayoutDensity(undefined)).toBe("normal");
    expect(resolveLayoutDensity(S({ layout_density: "tight" }))).toBe("normal");
    expect(layoutDensityClass("normal")).toBe("");
    expect(liffRootClass(S({ layout_density: "normal" }))).toBe("");
  });

  it("compact は root class に出る / 保存できる", () => {
    expect(layoutDensityClass("compact")).toBe("liff-density--compact");
    expect(liffRootClass(S({ layout_density: "compact" }))).toBe("liff-density--compact");
    expect(liffPageConfigSettingsSchema.safeParse({ layout_density: "compact" }).success).toBe(true);
    expect(liffPageConfigSettingsSchema.safeParse({ layout_density: "tight" }).success).toBe(false);
  });

  it("compact が上書きする対象のマーカー class が renderer 側に存在する（ドリフト防止）", () => {
    const acc = readFileSync(join(process.cwd(), "src/components/liff/accordion-depth-style.ts"), "utf8");
    for (const d of [1, 2, 3] as const) {
      expect(accordionDepthStyle(d).header).toContain(`liff-acc-h--${d}`);
      expect(accordionDepthStyle(d).panel).toContain(`liff-acc-p--${d}`);
      expect(CSS).toContain(`.liff-density--compact .liff-acc-h--${d}`);
      expect(CSS).toContain(`.liff-density--compact .liff-acc-p--${d}`);
    }
    expect(acc).toContain("layout_density");
    for (const f of ["src/components/liff/LiffRenderer.tsx", "src/components/liff/HintSiteRenderer.tsx"]) {
      expect(readFileSync(join(process.cwd(), f), "utf8")).toContain("liff-block-sep");
    }
    expect(readFileSync(join(process.cwd(), "src/components/liff/renderers/TextBlock.tsx"), "utf8"))
      .toContain("liff-body-text");
    expect(CSS).toContain(".liff-density--compact .liff-block-sep");
    expect(CSS).toContain(".liff-density--compact .liff-body-text");
  });

  it("compact は余白系プロパティだけを上書きする（色・階層インデントには触れない）", () => {
    const allowed = /^(min-height|padding-top|padding-bottom|gap|margin-bottom|line-height):/;
    for (const sel of selectorsOf(CSS)) {
      if (!sel.includes("liff-density--compact")) continue;
      for (const d of declarations(ruleBody(CSS, sel + " {")!)) {
        expect(d).toMatch(allowed);
      }
    }
  });
});

describe("本文の「細め」— 300 を持つテーマだけ下げる", () => {
  it("既定 (LINE Seed JP) の細めは 400 のまま（300 指定だと Thin 100 に落ちるため）", () => {
    const light = declarations(ruleBody(CSS, ".liff-font-weight--light {")!);
    expect(light).toContain("--liff-fw-normal: 400");
  });

  it("gothic / rounded / classic / modern の細めだけ 300 に下げる", () => {
    const sel = selectorsOf(CSS).find((x) => x.includes("liff-font-theme--gothic.liff-font-weight--light"))!;
    expect(sel).toBeTruthy();
    for (const t of ["rounded", "classic", "modern"]) {
      expect(sel).toContain(`liff-font-theme--${t}.liff-font-weight--light`);
    }
    // 宣言は 1 行（本文ウェイトのみ）。書体や色には触れない。
    const body = ruleBody(CSS, ".liff-font-theme--modern.liff-font-weight--light {")!;
    expect(declarations(body)).toEqual(["--liff-fw-normal: 300"]);
  });

  it("Light webfont は専用の遅延ロード component だけが import する", () => {
    const base = join(process.cwd(), "src/components/liff/fonts");
    expect(readFileSync(join(base, "LiffFontGothicLight.tsx"), "utf8")).toContain("@fontsource/noto-sans-jp/300.css");
    expect(readFileSync(join(base, "LiffFontRoundedLight.tsx"), "utf8")).toContain("@fontsource/m-plus-rounded-1c/300.css");
    expect(readFileSync(join(base, "LiffFontClassicLight.tsx"), "utf8")).toContain("@fontsource/noto-serif-jp/300.css");
    // 常時ロードには混ぜない（細めを選んでいないページの CSS を増やさない）
    expect(readFileSync(join(process.cwd(), "src/app/liff/layout.tsx"), "utf8")).not.toContain("/300.css");
  });
});
