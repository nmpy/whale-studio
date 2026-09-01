// src/__tests__/liff-spacing-levels.test.ts
//
// 場所ごとの余白:
//   - page_margin_x … 画面左右 (.liff-player-main の padding)
//   - block_gap     … ブロック同士の縦の間隔 (.liff-block-sep の pb / mb)
//
// layout_density が「全体を一括で詰める」のに対し、こちらは場所ごとに 狭い/標準/広い を選ぶ。
//
// 最重要の不変条件: どちらも "normal" は class を出さない = 既存ページの計算値と完全に一致。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolvePageMarginX,
  pageMarginXClass,
  resolveBlockGap,
  blockGapClass,
  liffRootClass,
} from "@/components/liff/liff-style-helpers";
import { liffPageConfigSettingsSchema } from "@/lib/validations";
import type { LiffPageConfigSettings } from "@/types";

const S = (o: Record<string, unknown>): LiffPageConfigSettings => o as LiffPageConfigSettings;
const CSS = readFileSync(join(process.cwd(), "src/app/liff/liff-font.css"), "utf8");

describe("後方互換 — 未設定ページは従来のまま", () => {
  it("未設定 / 空 / 不正値 / normal では root class が増えない", () => {
    expect(liffRootClass(undefined)).toBe("");
    expect(liffRootClass({})).toBe("");
    expect(liffRootClass(S({ page_margin_x: "normal", block_gap: "normal" }))).toBe("");
    expect(liffRootClass(S({ page_margin_x: "tight" }))).toBe("");
    expect(liffRootClass(S({ block_gap: null }))).toBe("");
  });

  // token の fallback が現行値と同値でないと、class が付かないページまで動いてしまう。
  it("画面左右は fallback 16px = 現行値と同値", () => {
    expect(CSS).toContain("padding-left: var(--liff-page-pad-x, 16px)");
    expect(CSS).toContain("padding-right: var(--liff-page-pad-x, 16px)");
  });
});

describe("画面左右の余白（page_margin_x）", () => {
  it("未設定・不正値は normal", () => {
    expect(resolvePageMarginX(undefined)).toBe("normal");
    expect(resolvePageMarginX({})).toBe("normal");
    expect(resolvePageMarginX(S({ page_margin_x: "tight" }))).toBe("normal");
  });

  it("narrow / wide だけ class が付く", () => {
    expect(pageMarginXClass("normal")).toBe("");
    expect(pageMarginXClass("narrow")).toBe("liff-margin-x--narrow");
    expect(pageMarginXClass("wide")).toBe("liff-margin-x--wide");
  });

  it("CSS はトークンだけを差し替える（padding 値を直接書かない）", () => {
    expect(CSS).toContain(".liff-margin-x--narrow { --liff-page-pad-x: 10px; }");
    expect(CSS).toContain(".liff-margin-x--wide { --liff-page-pad-x: 26px; }");
  });
});

describe("ブロック間の余白（block_gap）", () => {
  it("未設定・不正値は normal", () => {
    expect(resolveBlockGap(undefined)).toBe("normal");
    expect(resolveBlockGap(S({ block_gap: 0 }))).toBe("normal");
  });

  it("narrow / wide だけ class が付く", () => {
    expect(blockGapClass("normal")).toBe("");
    expect(blockGapClass("narrow")).toBe("liff-gap--narrow");
    expect(blockGapClass("wide")).toBe("liff-gap--wide");
  });

  // 同 specificity (0,2,0) なので「後に書いたほう」が勝つ。順序が崩れると
  // block_gap が density に負けて効かなくなるため、ここで固定する。
  it("CSS 上で .liff-gap--* が density より後ろにある（= 後勝ちで優先）", () => {
    const density = CSS.indexOf(".liff-density--compact .liff-block-sep");
    const gap = CSS.indexOf(".liff-gap--narrow .liff-block-sep");
    expect(density).toBeGreaterThan(-1);
    expect(gap).toBeGreaterThan(-1);
    expect(gap).toBeGreaterThan(density);
  });

  it("上下の padding と margin の両方を動かす（線の位置と間隔がズレないように）", () => {
    for (const n of ["narrow", "wide"]) {
      const rule = CSS.match(new RegExp(`\\.liff-gap--${n} \\.liff-block-sep \\{[^}]*\\}`))![0];
      expect(rule).toContain("padding-bottom:");
      expect(rule).toContain("margin-bottom:");
    }
  });
});

describe("2 つは独立している", () => {
  it("片方だけ / 両方 を指定できる", () => {
    expect(liffRootClass(S({ page_margin_x: "wide" }))).toBe("liff-margin-x--wide");
    expect(liffRootClass(S({ block_gap: "narrow" }))).toBe("liff-gap--narrow");
    const both = liffRootClass(S({ page_margin_x: "narrow", block_gap: "wide" }));
    expect(both).toContain("liff-margin-x--narrow");
    expect(both).toContain("liff-gap--wide");
  });

  it("layout_density と併用でき、両方 root に載る", () => {
    const cls = liffRootClass(S({ layout_density: "compact", block_gap: "wide" }));
    expect(cls).toContain("liff-density--compact");
    expect(cls).toContain("liff-gap--wide");
  });
});

describe("保存バリデーション", () => {
  it("3 段階だけ通る", () => {
    for (const k of ["page_margin_x", "block_gap"]) {
      for (const v of ["narrow", "normal", "wide"]) {
        expect(liffPageConfigSettingsSchema.safeParse({ [k]: v }).success).toBe(true);
      }
      expect(liffPageConfigSettingsSchema.safeParse({ [k]: "tight" }).success).toBe(false);
    }
    expect(liffPageConfigSettingsSchema.safeParse({}).success).toBe(true);
  });
});
