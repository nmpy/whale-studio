// src/__tests__/message-order.test.ts
// 送信順の決定論ソート（sortOrder → createdAt → id）と、buildKeywordMessages が入力順を保つ検証。

import { describe, it, expect } from "vitest";
import { compareDeliveryOrder, sortRecordsForDelivery } from "@/lib/message-order";
import { buildKeywordMessages, type KeywordMessageRecord } from "@/lib/line";

describe("sortRecordsForDelivery（送信順の決定論ソート）", () => {
  it("ランダム入力でも sortOrder 昇順に並ぶ", () => {
    const input = [
      { id: "c", sortOrder: 2 },
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 1 },
    ];
    expect(sortRecordsForDelivery(input).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("sortOrder 同値なら createdAt 昇順で安定", () => {
    const input = [
      { id: "y", sortOrder: 0, createdAt: "2026-01-02T00:00:00Z" },
      { id: "x", sortOrder: 0, createdAt: "2026-01-01T00:00:00Z" },
    ];
    expect(sortRecordsForDelivery(input).map((r) => r.id)).toEqual(["x", "y"]);
  });

  it("sortOrder・createdAt 同値なら id 昇順で安定（完全決定論）", () => {
    const t = "2026-01-01T00:00:00Z";
    const input = [
      { id: "b", sortOrder: 0, createdAt: t },
      { id: "a", sortOrder: 0, createdAt: t },
      { id: "c", sortOrder: 0, createdAt: t },
    ];
    expect(sortRecordsForDelivery(input).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("sortOrder が null の古いデータは末尾に寄り、createdAt→id で安定", () => {
    const input = [
      { id: "n2", sortOrder: null, createdAt: "2026-01-02T00:00:00Z" },
      { id: "ordered", sortOrder: 0 },
      { id: "n1", sortOrder: null, createdAt: "2026-01-01T00:00:00Z" },
    ];
    expect(sortRecordsForDelivery(input).map((r) => r.id)).toEqual(["ordered", "n1", "n2"]);
  });

  it("元配列を破壊しない", () => {
    const input = [{ id: "b", sortOrder: 1 }, { id: "a", sortOrder: 0 }];
    sortRecordsForDelivery(input);
    expect(input.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("compareDeliveryOrder 単体: sortOrder 優先", () => {
    expect(compareDeliveryOrder({ id: "a", sortOrder: 0 }, { id: "b", sortOrder: 1 })).toBeLessThan(0);
  });
});

function rec(over: Partial<KeywordMessageRecord> & { id: string }): KeywordMessageRecord {
  return {
    messageType: "text",
    body: over.id,
    assetUrl: null, altText: null, flexPayloadJson: null,
    quickReplies: null, nextMessageId: null, sortOrder: 0,
    character: null,
    ...over,
  } as KeywordMessageRecord;
}

describe("buildKeywordMessages は入力レコード順を保持する", () => {
  it("text/image/flex/quickReply が混在しても入力順どおりに LineMessage を生成", () => {
    const records: KeywordMessageRecord[] = [
      rec({ id: "msg-a", body: "A" }),
      rec({ id: "msg-b", messageType: "image", assetUrl: "https://example.com/b.png", body: null }),
      rec({ id: "msg-c", messageType: "flex", flexPayloadJson: '{"type":"bubble"}', altText: "C", body: null }),
      rec({ id: "msg-d", body: "D", quickReplies: JSON.stringify([{ label: "次へ", action: "text", value: "次へ" }]) }),
    ];
    const out = buildKeywordMessages(records);
    // 生成された各 LineMessage の識別子（text=本文 / image=url末尾 / flex=altText）で順序検証。
    const ids = out.map((m) => {
      const x = m as { type: string; text?: string; altText?: string; originalContentUrl?: string };
      if (x.type === "text") return x.text;
      if (x.type === "flex") return x.altText;
      if (x.type === "image") return "B-image";
      return x.type;
    });
    expect(ids).toEqual(["A", "B-image", "C", "D"]);
  });
});
