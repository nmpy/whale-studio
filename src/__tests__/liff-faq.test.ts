/**
 * src/__tests__/liff-faq.test.ts
 *
 * PR4: FAQ ページの純ロジック + settings validation を検証する。
 *  - visibleFaqItems: 未設定/空/空項目でも 500 にならず安全に整形する（renderer 安全性）
 *  - liffPageConfigSettingsSchema: faq_items の validation
 */
import { describe, it, expect } from "vitest";
import { visibleFaqItems } from "@/components/liff/faq-helpers";
import { liffPageConfigSettingsSchema } from "@/lib/validations";

describe("visibleFaqItems — 未設定セーフ + 空項目除外", () => {
  it("undefined / null / 非配列 は空配列（落ちない）", () => {
    expect(visibleFaqItems(undefined)).toEqual([]);
    expect(visibleFaqItems(null)).toEqual([]);
    // 非配列が来ても落ちない
    expect(visibleFaqItems({} as never)).toEqual([]);
  });

  it("空配列はそのまま空", () => {
    expect(visibleFaqItems([])).toEqual([]);
  });

  it("question / answer が両方空（空白のみ含む）の項目は除外", () => {
    expect(visibleFaqItems([{ question: "", answer: "" }])).toEqual([]);
    expect(visibleFaqItems([{ question: "  ", answer: "\n" }])).toEqual([]);
  });

  it("question だけ / answer だけでも表示対象に残る", () => {
    expect(visibleFaqItems([{ question: "Q", answer: "" }])).toHaveLength(1);
    expect(visibleFaqItems([{ question: "", answer: "A" }])).toHaveLength(1);
  });

  it("複数項目は順序を維持して残る（空項目だけ除外）", () => {
    const out = visibleFaqItems([
      { question: "Q1", answer: "A1" },
      { question: "", answer: "" },
      { question: "Q2", answer: "A2" },
    ]);
    expect(out.map((x) => x.question)).toEqual(["Q1", "Q2"]);
  });
});

describe("liffPageConfigSettingsSchema — faq_items validation", () => {
  it("faq_items 未指定でも success（既存ページ互換）", () => {
    expect(liffPageConfigSettingsSchema.safeParse({}).success).toBe(true);
  });
  it("faq_items 空配列でも success", () => {
    expect(liffPageConfigSettingsSchema.safeParse({ faq_items: [] }).success).toBe(true);
  });
  it("妥当な FAQ 項目は success（空文字 question/answer も max 制約のみで許容）", () => {
    expect(liffPageConfigSettingsSchema.safeParse({
      faq_items: [{ id: "x", question: "チケットは?", answer: "公式から購入できます" }, { question: "", answer: "" }],
    }).success).toBe(true);
  });
  it("question が 300 文字超は失敗", () => {
    expect(liffPageConfigSettingsSchema.safeParse({
      faq_items: [{ question: "あ".repeat(301), answer: "ok" }],
    }).success).toBe(false);
  });
  it("answer が 3000 文字超は失敗", () => {
    expect(liffPageConfigSettingsSchema.safeParse({
      faq_items: [{ question: "ok", answer: "あ".repeat(3001) }],
    }).success).toBe(false);
  });
});
