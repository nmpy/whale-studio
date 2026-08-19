/**
 * src/__tests__/liff-accordion-depth-style.test.ts
 * アコーディオンの depth → 見た目の対応（純関数）。
 *
 * 目的は「L1 / L2 / L3 が見た目で区別できること」を機械的に固定すること。
 * 具体的な px 値そのものではなく、depth が進むごとに
 *   - 文字サイズが小さくなる
 *   - ヘッダー高が低くなる
 *   - インデントとガイド線が付く
 *   - 見出しレベルが 1 段下がる
 * という「単調な関係」を検証する（デザイン調整で数値が動いても壊れないように）。
 */
import { describe, it, expect } from "vitest";
import {
  accordionDepthStyle,
  clampAccordionDepth,
  accordionEditorIndentClass,
} from "@/components/liff/accordion-depth-style";

/** "text-[16px]" → 16 のように、クラス文字列から px 値を取り出す。 */
function px(cls: string, prefix: string): number {
  const m = cls.match(new RegExp(`${prefix}-\\[(\\d+)px\\]`));
  if (!m) throw new Error(`"${prefix}-[Npx]" が見つかりません: ${cls}`);
  return Number(m[1]);
}

describe("clampAccordionDepth", () => {
  it("1〜3 はそのまま", () => {
    expect(clampAccordionDepth(1)).toBe(1);
    expect(clampAccordionDepth(2)).toBe(2);
    expect(clampAccordionDepth(3)).toBe(3);
  });
  it("範囲外・不正値でも落ちずに 1〜3 に丸める", () => {
    expect(clampAccordionDepth(0)).toBe(1);
    expect(clampAccordionDepth(-5)).toBe(1);
    expect(clampAccordionDepth(4)).toBe(3);
    expect(clampAccordionDepth(999)).toBe(3);
    expect(clampAccordionDepth(2.7)).toBe(2);
    expect(clampAccordionDepth(undefined)).toBe(1);
    expect(clampAccordionDepth(null)).toBe(1);
    expect(clampAccordionDepth("2")).toBe(1);
    expect(clampAccordionDepth(NaN)).toBe(1);
    expect(clampAccordionDepth(Infinity)).toBe(1);
  });
});

describe("accordionDepthStyle", () => {
  const s1 = accordionDepthStyle(1);
  const s2 = accordionDepthStyle(2);
  const s3 = accordionDepthStyle(3);

  it("depth が進むほどタイトルの文字サイズが小さくなる", () => {
    const t1 = px(s1.title, "text");
    const t2 = px(s2.title, "text");
    const t3 = px(s3.title, "text");
    expect(t1).toBeGreaterThan(t2);
    expect(t2).toBeGreaterThan(t3);
  });

  it("depth が進むほどヘッダー高が低くなる", () => {
    const h1 = px(s1.header, "min-h");
    const h2 = px(s2.header, "min-h");
    const h3 = px(s3.header, "min-h");
    expect(h1).toBeGreaterThan(h2);
    expect(h2).toBeGreaterThan(h3);
  });

  it("L1 は従来どおり 16px / 60px を維持する（既存ページの印象を変えない）", () => {
    expect(px(s1.title, "text")).toBe(16);
    expect(px(s1.header, "min-h")).toBe(60);
    expect(s1.title).toContain("font-bold");
  });

  it("全 depth のパネルに縦ガイド線と左インデントが付く（＝中身であることが分かる）", () => {
    for (const s of [s1, s2, s3]) {
      expect(s.panel).toContain("border-l");
      expect(s.panel).toMatch(/\bpl-/);
      expect(s.panel).toContain("flex flex-col");
    }
  });

  it("インデントは深くなるほど小さい（スマホで本文幅を潰さない）", () => {
    // pl-3 = 12px, pl-2.5 = 10px。深部で倍々に増やさないことを固定する。
    expect(s1.panel).toContain("pl-3");
    expect(s2.panel).toContain("pl-2.5");
    expect(s3.panel).toContain("pl-2.5");
  });

  it("見出しレベルが depth ごとに 1 段下がる（ページ h2 / ブロック h3 の既存規約に接続）", () => {
    expect(s1.headingTag).toBe("h3");
    expect(s2.headingTag).toBe("h4");
    expect(s3.headingTag).toBe("h5");
  });

  it("depth 範囲外でも style を返し、例外を投げない", () => {
    expect(accordionDepthStyle(99)).toEqual(s3);
    expect(accordionDepthStyle(0)).toEqual(s1);
    expect(accordionDepthStyle(undefined)).toEqual(s1);
  });

  it("全 depth が区切り線を持つ（隣接項目との境界が消えない）", () => {
    for (const s of [s1, s2, s3]) expect(s.section).toContain("border-b");
  });
});

describe("accordionEditorIndentClass", () => {
  it("CMS 側も深くなるほど詰める", () => {
    expect(accordionEditorIndentClass(1)).toBe("pl-3");
    expect(accordionEditorIndentClass(2)).toBe("pl-2.5");
    expect(accordionEditorIndentClass(3)).toBe("pl-2.5");
  });
  it("不正値でも文字列を返す", () => {
    expect(typeof accordionEditorIndentClass(undefined)).toBe("string");
    expect(typeof accordionEditorIndentClass(-1)).toBe("string");
  });
});
