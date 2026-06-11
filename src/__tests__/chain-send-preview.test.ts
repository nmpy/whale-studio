// src/__tests__/chain-send-preview.test.ts
// 連続メッセージ編集の実送信プレビュー（freeInput 停止・応答分離・5通超え）。
import { describe, it, expect } from "vitest";
import { previewChainSend, type ChainPreviewSlot } from "@/app/oas/[id]/works/[workId]/messages/_chain-send-preview";

const s = (body: string, free = false): ChainPreviewSlot => ({ body, message_type: "text", free_input_enabled: free });

describe("previewChainSend", () => {
  it("freeInput なし: head + slots すべて即時送信・応答なし", () => {
    const r = previewChainSend(s("手紙にはこう"), [s("くらい海でも"), s("光る生きもの")]);
    expect(r.sendMessages.map((x) => x.label)).toEqual(["手紙にはこう", "くらい海でも", "光る生きもの"]);
    expect(r.total).toBe(3);
    expect(r.freeInputAt).toBeNull();
    expect(r.responseMessages).toEqual([]);
    expect(r.overLimit).toBe(false);
  });

  it("freeInput で即時送信が停止し、以降は応答として分離される", () => {
    // head, s2, freeInputプロンプト, 応答
    const r = previewChainSend(s("ありがとう"), [s("もう少し"), s("あなたも手伝って", true), s("{freeText}…！")]);
    expect(r.sendMessages.map((x) => x.label)).toEqual(["ありがとう", "もう少し", "あなたも手伝って"]); // freeInput 含めて停止
    expect(r.freeInputAt).toBe(2); // sendMessages[2] が freeInput
    expect(r.sendMessages[2].freeInput).toBe(true);
    expect(r.responseMessages.map((x) => x.label)).toEqual(["{freeText}…！"]); // 応答は別枠
    expect(r.total).toBe(3);
  });

  it("head 自体が freeInput なら即時送信は head のみ・以降は応答", () => {
    const r = previewChainSend(s("入力して", true), [s("応答1"), s("応答2")]);
    expect(r.sendMessages.map((x) => x.label)).toEqual(["入力して"]);
    expect(r.freeInputAt).toBe(0);
    expect(r.responseMessages.map((x) => x.label)).toEqual(["応答1", "応答2"]);
  });

  it("即時送信が6通以上で overLimit", () => {
    const r = previewChainSend(s("h"), [s("2"), s("3"), s("4"), s("5"), s("6")]);
    expect(r.total).toBe(6);
    expect(r.overLimit).toBe(true);
  });

  it("即時送信ちょうど5通は overLimit ではない", () => {
    const r = previewChainSend(s("h"), [s("2"), s("3"), s("4"), s("5")]);
    expect(r.total).toBe(5);
    expect(r.overLimit).toBe(false);
  });

  it("freeInput より前で5通超えなら overLimit（freeInputは6通目以降）", () => {
    const r = previewChainSend(s("h"), [s("2"), s("3"), s("4"), s("5"), s("6", true), s("応答")]);
    expect(r.sendMessages.length).toBe(6); // h..6(freeInput) 即時送信扱い
    expect(r.overLimit).toBe(true);
    expect(r.responseMessages.map((x) => x.label)).toEqual(["応答"]);
  });
});
