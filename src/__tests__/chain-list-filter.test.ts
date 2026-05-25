// src/__tests__/chain-list-filter.test.ts
//
// メッセージ一覧で「next_message_id チェーンの継続メッセージ」を非表示にする
// 純関数の単体テスト。Phase 2a スコープ。

import { describe, it, expect } from "vitest";
import {
  collectChainContinuationIds,
  chainSizeFrom,
  getChainContinuations,
  hasAnyTiming,
  summarizeTiming,
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

describe("getChainContinuations", () => {
  it("単独メッセージなら空配列を返す (= head 以外の chain なし)", () => {
    const messages = [{ id: "a", next_message_id: null }];
    expect(getChainContinuations(messages, "a")).toEqual([]);
  });

  it("a → b chain: head=a なら [b]、head 自身は含まれない", () => {
    const messages = [
      { id: "a", next_message_id: "b" },
      { id: "b", next_message_id: null },
    ];
    const r = getChainContinuations(messages, "a");
    expect(r.map((m) => m.id)).toEqual(["b"]);
  });

  it("a → b → c chain: head=a なら [b, c]", () => {
    const messages = [
      { id: "a", next_message_id: "b" },
      { id: "b", next_message_id: "c" },
      { id: "c", next_message_id: null },
    ];
    const r = getChainContinuations(messages, "a");
    expect(r.map((m) => m.id)).toEqual(["b", "c"]);
  });

  it("循環参照でも head は重複追加されず無限ループしない", () => {
    const messages = [
      { id: "a", next_message_id: "b" },
      { id: "b", next_message_id: "a" },  // 循環
    ];
    const r = getChainContinuations(messages, "a");
    // b は追加されるが a は visited なので停止
    expect(r.map((m) => m.id)).toEqual(["b"]);
  });

  it("ghost reference があってもクラッシュしない", () => {
    const messages = [
      { id: "a", next_message_id: "ghost" },
    ];
    expect(getChainContinuations(messages, "a")).toEqual([]);
  });

  it("head が見つからなければ空配列", () => {
    expect(getChainContinuations([], "missing")).toEqual([]);
  });

  it("4 件まで walk (= LINE 上限 5 件 - head 1 件)", () => {
    // 6 通の chain → continuation は 4 件まで
    const messages = Array.from({ length: 6 }, (_, i) => ({
      id: `m${i}`,
      next_message_id: i < 5 ? `m${i + 1}` : null,
    }));
    const r = getChainContinuations(messages, "m0");
    expect(r.length).toBe(4);
    expect(r.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("呼び出し側が渡した全プロパティが保持される (= generic 型)", () => {
    type WithBody = { id: string; next_message_id?: string | null; body: string };
    const messages: WithBody[] = [
      { id: "a", next_message_id: "b", body: "msg1 body" },
      { id: "b", next_message_id: null, body: "msg2 body" },
    ];
    const r = getChainContinuations(messages, "a");
    expect(r[0].body).toBe("msg2 body");
  });
});

// ──────────────────────────────────────────────────────────
// Phase 2c: hasAnyTiming / summarizeTiming
// ──────────────────────────────────────────────────────────

describe("hasAnyTiming (Phase 2c)", () => {
  it("全フィールド null / undefined なら false", () => {
    expect(hasAnyTiming({})).toBe(false);
    expect(hasAnyTiming({
      lag_ms: null, read_receipt_mode: null, typing_enabled: null, loading_enabled: null,
    })).toBe(false);
  });

  it("lag_ms=0 は default 扱いで false (= 「演出なし」表示)", () => {
    expect(hasAnyTiming({ lag_ms: 0 })).toBe(false);
  });

  it("lag_ms > 0 なら true (= 「待機時間あり」=演出あり扱い)", () => {
    expect(hasAnyTiming({ lag_ms: 1000 })).toBe(true);
  });

  it('read_receipt_mode="inherit" は false (= 上位から継承=自分で設定していない)', () => {
    expect(hasAnyTiming({ read_receipt_mode: "inherit" })).toBe(false);
  });

  it('read_receipt_mode="delayed" は true', () => {
    expect(hasAnyTiming({ read_receipt_mode: "delayed" })).toBe(true);
  });

  it("typing_enabled=false は明示 false なので true (= 演出設定が入っている)", () => {
    expect(hasAnyTiming({ typing_enabled: false })).toBe(true);
  });

  it("typing_enabled=true は当然 true", () => {
    expect(hasAnyTiming({ typing_enabled: true })).toBe(true);
  });

  it("loading_enabled=false / read_delay_ms=0 でも null との区別で true", () => {
    expect(hasAnyTiming({ loading_enabled: false })).toBe(true);
    expect(hasAnyTiming({ read_delay_ms: 0 })).toBe(true);
  });
});

describe("summarizeTiming (Phase 2c)", () => {
  it("全 null なら 'あり' のみで詳細なし", () => {
    expect(summarizeTiming({})).toBe("演出: 設定あり");
  });

  it("lag_ms=2000 → '待機 2秒' を含む", () => {
    expect(summarizeTiming({ lag_ms: 2000 })).toContain("待機 2秒");
  });

  it("lag_ms=1500 → '待機 1.5秒' (= 小数表示)", () => {
    expect(summarizeTiming({ lag_ms: 1500 })).toContain("待機 1.5秒");
  });

  it("typing_enabled=true → '送信前の間' を含む (= 旧: 'typing')", () => {
    expect(summarizeTiming({ typing_enabled: true })).toContain("送信前の間");
  });

  it('read_receipt_mode="delayed" + read_delay_ms=1000 → "既読遅延 1秒"', () => {
    expect(summarizeTiming({ read_receipt_mode: "delayed", read_delay_ms: 1000 })).toContain("既読遅延 1秒");
  });

  it('read_receipt_mode="before_reply" → "既読(返信直前)"', () => {
    expect(summarizeTiming({ read_receipt_mode: "before_reply" })).toContain("既読(返信直前)");
  });

  it("複合 (lag + typing + delayed read) は全て併記される", () => {
    const s = summarizeTiming({
      lag_ms: 2000,
      typing_enabled: true,
      read_receipt_mode: "delayed", read_delay_ms: 1500,
    });
    expect(s).toContain("待機 2秒");
    expect(s).toContain("送信前の間");
    expect(s).toContain("既読遅延 1.5秒");
  });

  it("loading_enabled=true → '「入力中...」' を含む (= 旧: 'ローディング')", () => {
    expect(summarizeTiming({ loading_enabled: true })).toContain("「入力中...」");
  });
});
