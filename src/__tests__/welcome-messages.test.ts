// src/__tests__/welcome-messages.test.ts
//
// parseWelcomeMessages（あいさつ複数件 JSON の正規化）の検証。
// webhook ランタイムで使うため throw しない（不正は drop / 空化）。
import { describe, it, expect } from "vitest";
import { parseWelcomeMessages, WELCOME_MESSAGES_MAX } from "@/lib/welcome-messages";

describe("parseWelcomeMessages", () => {
  it("非配列 → []", () => {
    expect(parseWelcomeMessages(null)).toEqual([]);
    expect(parseWelcomeMessages(undefined)).toEqual([]);
    expect(parseWelcomeMessages({})).toEqual([]);
    expect(parseWelcomeMessages(42)).toEqual([]);
  });

  it("不正 JSON 文字列 → []", () => {
    expect(parseWelcomeMessages("{not json")).toEqual([]);
    expect(parseWelcomeMessages("")).toEqual([]);
  });

  it("JSON 文字列の配列もパースする", () => {
    expect(parseWelcomeMessages(JSON.stringify([{ type: "text", text: "やあ" }]))).toEqual([
      { type: "text", text: "やあ" },
    ]);
  });

  it("text 1件", () => {
    expect(parseWelcomeMessages([{ type: "text", text: "こんにちは" }])).toEqual([
      { type: "text", text: "こんにちは" },
    ]);
  });

  it("text 複数件（順序維持・trim される）", () => {
    expect(parseWelcomeMessages([
      { type: "text", text: "  1通目  " },
      { type: "text", text: "2通目" },
    ])).toEqual([
      { type: "text", text: "1通目" },
      { type: "text", text: "2通目" },
    ]);
  });

  it("image 1件（https）", () => {
    expect(parseWelcomeMessages([{ type: "image", imageUrl: "https://ex.com/a.png" }])).toEqual([
      { type: "image", imageUrl: "https://ex.com/a.png" },
    ]);
  });

  it("image: previewImageUrl(https) / altText を採用", () => {
    expect(parseWelcomeMessages([
      { type: "image", imageUrl: "https://ex.com/a.png", previewImageUrl: "https://ex.com/p.png", altText: "説明" },
    ])).toEqual([
      { type: "image", imageUrl: "https://ex.com/a.png", previewImageUrl: "https://ex.com/p.png", altText: "説明" },
    ]);
  });

  it("text + image 混在", () => {
    expect(parseWelcomeMessages([
      { type: "text", text: "やあ" },
      { type: "image", imageUrl: "https://ex.com/a.png" },
    ])).toEqual([
      { type: "text", text: "やあ" },
      { type: "image", imageUrl: "https://ex.com/a.png" },
    ]);
  });

  it("空 text は除外", () => {
    expect(parseWelcomeMessages([
      { type: "text", text: "   " },
      { type: "text", text: "有効" },
    ])).toEqual([{ type: "text", text: "有効" }]);
  });

  it("http(非https) image URL は除外", () => {
    expect(parseWelcomeMessages([
      { type: "image", imageUrl: "http://ex.com/a.png" },
      { type: "image", imageUrl: "https://ex.com/b.png" },
    ])).toEqual([{ type: "image", imageUrl: "https://ex.com/b.png" }]);
  });

  it("不正 item（未知 type / 欠落フィールド / 非オブジェクト）は drop", () => {
    expect(parseWelcomeMessages([
      { type: "flex" },                         // 未知 type
      { type: "text" },                         // text 欠落
      { type: "image" },                        // imageUrl 欠落
      "string",                                  // 非オブジェクト
      null,                                      // null
      { type: "text", text: "残る" },           // 有効
    ])).toEqual([{ type: "text", text: "残る" }]);
  });

  it("6件以上は先頭5件に切り詰め", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ type: "text" as const, text: `t${i + 1}` }));
    const out = parseWelcomeMessages(six);
    expect(out).toHaveLength(WELCOME_MESSAGES_MAX);
    expect(out).toEqual([
      { type: "text", text: "t1" }, { type: "text", text: "t2" }, { type: "text", text: "t3" },
      { type: "text", text: "t4" }, { type: "text", text: "t5" },
    ]);
  });

  it("有効 item が無ければ [] （fallback 用）", () => {
    expect(parseWelcomeMessages([{ type: "text", text: "" }, { foo: 1 }])).toEqual([]);
  });
});
