// src/__tests__/chain-expansion.test.ts
//
// 配列内 chain 展開 helper の単体テスト。
// runtime 送信時に next_message_id チェーンを「1 つの塊」として並べ直す挙動を担保する。

import { describe, it, expect } from "vitest";
import { expandChainsInArray, moveQuickReplyToTail } from "@/lib/chain-expansion";

type Msg = { id: string; nextId: string | null };
const getNextId = (m: Msg) => m.nextId;

describe("expandChainsInArray", () => {
  it("空配列 → 空配列", () => {
    expect(expandChainsInArray<Msg>([], getNextId)).toEqual([]);
  });

  it("単独メッセージ → そのまま", () => {
    const r = expandChainsInArray<Msg>([{ id: "a", nextId: null }], getNextId);
    expect(r.map((m) => m.id)).toEqual(["a"]);
  });

  it("a → b → c の chain: 入力 [a,b,c] → 出力 [a,b,c]", () => {
    const r = expandChainsInArray<Msg>(
      [
        { id: "a", nextId: "b" },
        { id: "b", nextId: "c" },
        { id: "c", nextId: null },
      ],
      getNextId,
    );
    expect(r.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("a → b → c の chain: 入力 [c,b,a] (順序逆) → 出力 [a,b,c] (head 起点)", () => {
    const r = expandChainsInArray<Msg>(
      [
        { id: "c", nextId: null },
        { id: "b", nextId: "c" },
        { id: "a", nextId: "b" },
      ],
      getNextId,
    );
    expect(r.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("2 つの独立 chain (a→b, x→y): 入力 [a,x,b,y] → 出力 [a,b,x,y]", () => {
    const r = expandChainsInArray<Msg>(
      [
        { id: "a", nextId: "b" },
        { id: "x", nextId: "y" },
        { id: "b", nextId: null },
        { id: "y", nextId: null },
      ],
      getNextId,
    );
    expect(r.map((m) => m.id)).toEqual(["a", "b", "x", "y"]);
  });

  it("chain と単独メッセージが混在: 入力 [a,z,b] → 出力 [a,b,z]", () => {
    // a → b chain と独立した z
    const r = expandChainsInArray<Msg>(
      [
        { id: "a", nextId: "b" },
        { id: "z", nextId: null },
        { id: "b", nextId: null },
      ],
      getNextId,
    );
    expect(r.map((m) => m.id)).toEqual(["a", "b", "z"]);
  });

  it("循環参照 (a → b → a) でも 5 件で打ち切り、無限ループしない", () => {
    const r = expandChainsInArray<Msg>(
      [
        { id: "a", nextId: "b" },
        { id: "b", nextId: "a" },  // 循環
      ],
      getNextId,
    );
    expect(r.length).toBeLessThanOrEqual(5);
    expect(r.length).toBeGreaterThanOrEqual(2);
  });

  it("maxChain=5 で打ち切り (7 件 chain でも 5 件まで)", () => {
    const records: Msg[] = Array.from({ length: 7 }, (_, i) => ({
      id: `m${i}`,
      nextId: i < 6 ? `m${i + 1}` : null,
    }));
    const r = expandChainsInArray<Msg>(records, getNextId, 5);
    // head から 5 件まで walk + 残りは disconnected として末尾に append される
    expect(r.length).toBe(7);  // 全 record は出力に含まれる (順序が違うだけ)
    expect(r.slice(0, 5).map((m) => m.id)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
  });

  it("配列内に無い next を指す record (= ghost ref) は単独として扱う", () => {
    // a → "ghost" (ghost は配列内に無い)
    const r = expandChainsInArray<Msg>(
      [{ id: "a", nextId: "ghost" }],
      getNextId,
    );
    expect(r.map((m) => m.id)).toEqual(["a"]);
  });

  it("入力順の sort_order を尊重: 入力 [b chain head, a chain head] → 出力もその順", () => {
    // 入力で b chain が先 → 出力でも b chain が先
    const r = expandChainsInArray<Msg>(
      [
        { id: "b1", nextId: "b2" },
        { id: "a1", nextId: "a2" },
        { id: "b2", nextId: null },
        { id: "a2", nextId: null },
      ],
      getNextId,
    );
    expect(r.map((m) => m.id)).toEqual(["b1", "b2", "a1", "a2"]);
  });
});

describe("moveQuickReplyToTail", () => {
  type LineMsg = { type: "text"; text: string; quickReply?: unknown };

  it("単一メッセージなら何もしない", () => {
    const msgs: LineMsg[] = [{ type: "text", text: "a", quickReply: { items: [] } }];
    moveQuickReplyToTail(msgs);
    expect(msgs[0].quickReply).toBeDefined();
  });

  it("先頭の QR を末尾に移動する", () => {
    const qr = { items: ["test"] };
    const msgs: LineMsg[] = [
      { type: "text", text: "a", quickReply: qr },
      { type: "text", text: "b" },
    ];
    moveQuickReplyToTail(msgs);
    expect(msgs[0].quickReply).toBeUndefined();
    expect(msgs[1].quickReply).toBe(qr);
  });

  it("既に末尾にあればそのまま", () => {
    const qr = { items: ["test"] };
    const msgs: LineMsg[] = [
      { type: "text", text: "a" },
      { type: "text", text: "b", quickReply: qr },
    ];
    moveQuickReplyToTail(msgs);
    expect(msgs[0].quickReply).toBeUndefined();
    expect(msgs[1].quickReply).toBe(qr);
  });

  it("中間の QR を末尾に移動 (3 件 chain)", () => {
    const qr = { items: ["test"] };
    const msgs: LineMsg[] = [
      { type: "text", text: "a" },
      { type: "text", text: "b", quickReply: qr },
      { type: "text", text: "c" },
    ];
    moveQuickReplyToTail(msgs);
    expect(msgs[0].quickReply).toBeUndefined();
    expect(msgs[1].quickReply).toBeUndefined();
    expect(msgs[2].quickReply).toBe(qr);
  });

  it("複数の QR が中間にある場合、最後の方を末尾に移動", () => {
    const qr1 = { items: ["1"] };
    const qr2 = { items: ["2"] };
    const msgs: LineMsg[] = [
      { type: "text", text: "a", quickReply: qr1 },
      { type: "text", text: "b", quickReply: qr2 },
      { type: "text", text: "c" },
    ];
    moveQuickReplyToTail(msgs);
    // 末尾から走査するため qr2 が末尾へ
    expect(msgs[2].quickReply).toBe(qr2);
    // qr1 は残る (LINE 側で表示されないが本 helper は触らない)
    expect(msgs[0].quickReply).toBe(qr1);
  });

  it("QR を持つメッセージが 1 つもなければ何も変わらない", () => {
    const msgs: LineMsg[] = [
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ];
    moveQuickReplyToTail(msgs);
    expect(msgs[0].quickReply).toBeUndefined();
    expect(msgs[1].quickReply).toBeUndefined();
  });
});
