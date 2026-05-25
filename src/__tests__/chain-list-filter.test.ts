// src/__tests__/chain-list-filter.test.ts
//
// メッセージ一覧で「next_message_id チェーンの継続メッセージ」を非表示にする
// 純関数の単体テスト。Phase 2a スコープ。

import { describe, it, expect } from "vitest";
import {
  collectChainContinuationIds,
  chainSizeFrom,
} from "@/app/oas/[id]/works/[workId]/messages/_list-helpers";

describe("collectChainContinuationIds", () => {
  it("next_message_id が空ならどれも継続扱いされない (= すべて chain head)", () => {
    const ids = collectChainContinuationIds([
      { id: "a", next_message_id: null },
      { id: "b", next_message_id: null },
    ]);
    expect(ids.size).toBe(0);
  });

  it("a → b → c のチェーン: b と c が継続扱い (a だけが head)", () => {
    const ids = collectChainContinuationIds([
      { id: "a", next_message_id: "b" },
      { id: "b", next_message_id: "c" },
      { id: "c", next_message_id: null },
    ]);
    expect(ids).toEqual(new Set(["b", "c"]));
  });

  it("複数の独立チェーン (a → b, x → y → z) を正しく検出", () => {
    const ids = collectChainContinuationIds([
      { id: "a", next_message_id: "b" },
      { id: "b", next_message_id: null },
      { id: "x", next_message_id: "y" },
      { id: "y", next_message_id: "z" },
      { id: "z", next_message_id: null },
    ]);
    expect(ids).toEqual(new Set(["b", "y", "z"]));
  });

  it("空配列でも落ちない", () => {
    expect(collectChainContinuationIds([]).size).toBe(0);
  });

  it("next_message_id が undefined のレコードを正しく扱う (= 継続扱いしない)", () => {
    const ids = collectChainContinuationIds([
      { id: "a" },
      { id: "b" },
    ]);
    expect(ids.size).toBe(0);
  });
});

describe("chainSizeFrom", () => {
  it("単独メッセージは 1 を返す (= バッジは N > 1 のときだけ表示する想定)", () => {
    const messages = [{ id: "a", next_message_id: null }];
    expect(chainSizeFrom(messages, "a")).toBe(1);
  });

  it("a → b → c で a 起点なら 3 (= head + 子孫 2)", () => {
    const messages = [
      { id: "a", next_message_id: "b" },
      { id: "b", next_message_id: "c" },
      { id: "c", next_message_id: null },
    ];
    expect(chainSizeFrom(messages, "a")).toBe(3);
  });

  it("a → b → c で b 起点なら 2 (= b + c)", () => {
    const messages = [
      { id: "a", next_message_id: "b" },
      { id: "b", next_message_id: "c" },
      { id: "c", next_message_id: null },
    ];
    expect(chainSizeFrom(messages, "b")).toBe(2);
  });

  it("2 通 chain (a → b) なら 2", () => {
    const messages = [
      { id: "a", next_message_id: "b" },
      { id: "b", next_message_id: null },
    ];
    expect(chainSizeFrom(messages, "a")).toBe(2);
  });

  it("LINE 上限である 5 件で打ち切る (循環がなくても)", () => {
    const messages = Array.from({ length: 7 }, (_, i) => ({
      id: `m${i}`,
      next_message_id: i < 6 ? `m${i + 1}` : null,
    }));
    expect(chainSizeFrom(messages, "m0")).toBe(5);
  });

  it("循環参照 (a → b → a) でも無限ループしない", () => {
    const messages = [
      { id: "a", next_message_id: "b" },
      { id: "b", next_message_id: "a" },  // 循環
    ];
    const n = chainSizeFrom(messages, "a");
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(5);
  });

  it("head が見つからなければ 0", () => {
    expect(chainSizeFrom([], "missing")).toBe(0);
  });

  it("next_message_id が存在しない ID を指していてもクラッシュしない", () => {
    const messages = [
      { id: "a", next_message_id: "ghost" },
    ];
    expect(chainSizeFrom(messages, "a")).toBe(1);
  });
});
