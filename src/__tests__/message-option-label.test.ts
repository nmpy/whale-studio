// src/__tests__/message-option-label.test.ts
import { describe, it, expect } from "vitest";
import { formatMessageOptionLabel } from "@/lib/message-option-label";

describe("formatMessageOptionLabel", () => {
  it("フェーズ名 + 本文抜粋", () => {
    expect(formatMessageOptionLabel({ body: "いらっしゃいませ", message_type: "text", phase: { name: "受付" } }))
      .toBe("受付: いらっしゃいませ");
  });

  it("フェーズ未設定なら接頭辞なし", () => {
    expect(formatMessageOptionLabel({ body: "こんにちは", message_type: "text", phase: null }))
      .toBe("こんにちは");
  });

  it("長い本文は 24 文字で切り詰めて … を付ける", () => {
    const body = "あ".repeat(40);
    const out = formatMessageOptionLabel({ body, message_type: "text" });
    expect(out).toBe(`${"あ".repeat(24)}…`);
  });

  it("改行・連続空白は 1 つに正規化", () => {
    expect(formatMessageOptionLabel({ body: "a\n\n  b", message_type: "text" })).toBe("a b");
  });

  it("本文が無い種別は種別名を括弧表示", () => {
    expect(formatMessageOptionLabel({ body: null, message_type: "image", phase: { name: "謎" } }))
      .toBe("謎: （画像）");
    expect(formatMessageOptionLabel({ body: "", message_type: "video" })).toBe("（動画）");
  });

  it("未知の種別 / 空入力でも壊れない", () => {
    expect(formatMessageOptionLabel({ body: null, message_type: "unknown_type" })).toBe("（unknown_type）");
    expect(formatMessageOptionLabel({})).toBe("（テキスト）");
  });
});
