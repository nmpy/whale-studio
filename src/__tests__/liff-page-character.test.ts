// src/__tests__/liff-page-character.test.ts
//
// ページ隅の装飾キャラクター画像 (settings_json.character_*)。
//
// 最重要の不変条件（3 つ）:
//   1. character_url が無ければ DOM を 1 要素も出さない = 既存ページは完全に不変
//   2. レイヤーは height:0 + pointer-events:none = 本文が下がらず、下のボタンも押せる
//   3. 画像の幅と、タイトルに空ける余白が **同じトークン** を読む（ズレると文字が潜る）

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveCharacterUrl,
  resolveCharacterSize,
  resolveCharacterPosition,
  resolveCharacterRendering,
  resolveCharacterFixed,
  characterRootClass,
  characterLayerClass,
  characterImageClass,
  liffRootClass,
} from "@/components/liff/liff-style-helpers";
import { liffPageConfigSettingsSchema } from "@/lib/validations";
import type { LiffPageConfigSettings } from "@/types";

const S = (o: Record<string, unknown>): LiffPageConfigSettings => o as LiffPageConfigSettings;
const CSS = readFileSync(join(process.cwd(), "src/app/liff/liff-font.css"), "utf8");
const URL_OK = "https://example.com/dot.png";

function ruleBody(sel: string): string {
  const i = CSS.indexOf(sel);
  expect(i, `${sel} が CSS に無い`).toBeGreaterThan(-1);
  return CSS.slice(CSS.indexOf("{", i) + 1, CSS.indexOf("}", i));
}

describe("後方互換 — 画像未設定なら完全に不変", () => {
  it("URL が無ければ root class は空文字", () => {
    expect(characterRootClass(undefined)).toBe("");
    expect(characterRootClass({})).toBe("");
    expect(characterRootClass(S({ character_url: "" }))).toBe("");
    expect(characterRootClass(S({ character_url: "   " }))).toBe("");
    expect(characterRootClass(S({ character_url: 123 }))).toBe("");
    // サイズ等だけ指定されていても、URL が無ければ何も出さない
    expect(characterRootClass(S({ character_size: "lg", character_position: "top_left" }))).toBe("");
  });

  it("liffRootClass（他の設定）には影響しない", () => {
    expect(liffRootClass(S({ character_url: URL_OK }))).toBe("");
  });

  it("URL 解決は空白を落とし、空なら null", () => {
    expect(resolveCharacterUrl(S({ character_url: `  ${URL_OK}  ` }))).toBe(URL_OK);
    expect(resolveCharacterUrl(S({ character_url: "" }))).toBeNull();
    expect(resolveCharacterUrl(undefined)).toBeNull();
  });
});

describe("既定値", () => {
  it("サイズ md / 配置 top_right / 補間 pixelated / 固定 false", () => {
    expect(resolveCharacterSize(S({ character_size: "huge" }))).toBe("md");
    expect(resolveCharacterPosition(S({ character_position: "bottom" }))).toBe("top_right");
    expect(resolveCharacterRendering(S({ character_rendering: "blur" }))).toBe("pixelated");
    expect(resolveCharacterFixed(S({ character_fixed: "yes" }))).toBe(false);
    expect(resolveCharacterFixed(S({ character_fixed: true }))).toBe(true);
  });
});

describe("root / レイヤー / 画像の class", () => {
  it("URL があればサイズと余白確保の class が付く", () => {
    const cls = characterRootClass(S({ character_url: URL_OK }));
    expect(cls).toContain("liff-character-on");
    expect(cls).toContain("liff-character-size--md");
    expect(cls).toContain("liff-character-on--right");
  });

  it("配置を左にすると余白も左側に付く", () => {
    expect(characterRootClass(S({ character_url: URL_OK, character_position: "top_left" })))
      .toContain("liff-character-on--left");
  });

  // 固定表示は画面に浮くので、本文側に余白を作ると無駄な空白になる。
  it("固定表示のときは余白確保の class を付けない", () => {
    const cls = characterRootClass(S({ character_url: URL_OK, character_fixed: true }));
    expect(cls).toContain("liff-character-size--md");
    expect(cls).not.toContain("liff-character-on--right");
    expect(cls).not.toContain("liff-character-on--left");
  });

  it("レイヤー / 画像の class", () => {
    expect(characterLayerClass(false)).toBe("liff-character-layer");
    expect(characterLayerClass(true)).toBe("liff-character-layer liff-character-layer--fixed");
    expect(characterImageClass("top_right", "pixelated")).toBe("liff-character liff-character--right liff-character--pixelated");
    expect(characterImageClass("top_left", "smooth")).toBe("liff-character liff-character--left liff-character--smooth");
  });
});

describe("レイアウトを壊さない作り", () => {
  it("レイヤーは高さ 0 で、タップを吸わない", () => {
    const body = ruleBody(".liff-character-layer {");
    expect(body).toContain("height: 0");
    expect(body).toContain("pointer-events: none");
  });

  it("内側もコンテンツ列と同じ寸法で高さ 0", () => {
    const body = ruleBody(".liff-character-inner {");
    expect(body).toContain("height: 0");
    expect(body).toContain("max-width: 448px");
    // 「画面左右の余白」設定に追従する
    expect(body).toContain("var(--liff-page-pad-x, 16px)");
  });

  // 画像幅とタイトルの余白が別の値を読むと、文字がキャラの下に潜る / 余白が過剰になる。
  it("画像の幅とタイトルの余白が同じトークンを読む", () => {
    expect(ruleBody(".liff-character {")).toContain("width: var(--liff-character-size, 72px)");
    for (const side of ["right", "left"]) {
      const line = CSS.split("\n").find((l) => l.startsWith(`.liff-character-on--${side} .liff-h-title`))!;
      expect(line).toContain("var(--liff-character-size, 72px)");
    }
  });

  it("サイズ 3 段階が定義されている", () => {
    for (const [n, px] of [["sm", "48px"], ["md", "72px"], ["lg", "96px"]] as const) {
      expect(CSS).toContain(`.liff-character-size--${n} { --liff-character-size: ${px}; }`);
    }
  });

  it("固定表示はノッチ端末の safe-area を避ける", () => {
    expect(ruleBody(".liff-character-layer--fixed .liff-character {")).toContain("env(safe-area-inset-top)");
  });
});

describe("保存バリデーション", () => {
  it("URL は URL 形式か空文字だけ通る", () => {
    expect(liffPageConfigSettingsSchema.safeParse({ character_url: URL_OK }).success).toBe(true);
    expect(liffPageConfigSettingsSchema.safeParse({ character_url: "" }).success).toBe(true);
    expect(liffPageConfigSettingsSchema.safeParse({ character_url: "not-a-url" }).success).toBe(false);
  });

  it("列挙値と真偽値", () => {
    expect(liffPageConfigSettingsSchema.safeParse({ character_size: "lg" }).success).toBe(true);
    expect(liffPageConfigSettingsSchema.safeParse({ character_size: "huge" }).success).toBe(false);
    expect(liffPageConfigSettingsSchema.safeParse({ character_position: "top_left" }).success).toBe(true);
    expect(liffPageConfigSettingsSchema.safeParse({ character_position: "bottom" }).success).toBe(false);
    expect(liffPageConfigSettingsSchema.safeParse({ character_rendering: "smooth" }).success).toBe(true);
    expect(liffPageConfigSettingsSchema.safeParse({ character_fixed: true }).success).toBe(true);
    expect(liffPageConfigSettingsSchema.safeParse({ character_fixed: "yes" }).success).toBe(false);
    expect(liffPageConfigSettingsSchema.safeParse({}).success).toBe(true);
  });
});
