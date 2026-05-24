// src/__tests__/quick-reply-tail.test.ts
//
// moveQuickReplyToTail helper の単体テスト。
// chain head に付いた quickReply を chain tail (= 最後のメッセージ) に集約する挙動を担保する。

import { describe, it, expect } from "vitest";
import { moveQuickReplyToTail } from "@/lib/quick-reply-tail";

type LineMsg = { type: "text"; text: string; quickReply?: unknown };

describe("moveQuickReplyToTail", () => {
  it("単一メッセージなら何もしない", () => {
    const msgs: LineMsg[] = [{ type: "text", text: "a", quickReply: { items: ["x"] } }];
    moveQuickReplyToTail(msgs);
    expect(msgs[0].quickReply).toEqual({ items: ["x"] });
  });

  it("空配列なら何もしない (= 例外を出さない)", () => {
    const msgs: LineMsg[] = [];
    moveQuickReplyToTail(msgs);
    expect(msgs).toEqual([]);
  });

  it("先頭メッセージの quickReply を末尾へ移動する (= chain head → chain tail)", () => {
    const qr = { items: ["QRテスト１", "QRテスト２"] };
    const msgs: LineMsg[] = [
      { type: "text", text: "msg1", quickReply: qr },
      { type: "text", text: "msg2" },
    ];
    moveQuickReplyToTail(msgs);
    expect(msgs[0].quickReply).toBeUndefined();
    expect(msgs[1].quickReply).toBe(qr);
  });

  it("既に末尾にあればそのまま (= tail を優先)", () => {
    const qr = { items: ["tail-qr"] };
    const msgs: LineMsg[] = [
      { type: "text", text: "msg1" },
      { type: "text", text: "msg2", quickReply: qr },
    ];
    moveQuickReplyToTail(msgs);
    expect(msgs[0].quickReply).toBeUndefined();
    expect(msgs[1].quickReply).toBe(qr);
  });

  it("3 通 chain: 中間 msg2 の quickReply を msg3 (= tail) に移動", () => {
    const qr = { items: ["mid-qr"] };
    const msgs: LineMsg[] = [
      { type: "text", text: "msg1" },
      { type: "text", text: "msg2", quickReply: qr },
      { type: "text", text: "msg3" },
    ];
    moveQuickReplyToTail(msgs);
    expect(msgs[0].quickReply).toBeUndefined();
    expect(msgs[1].quickReply).toBeUndefined();
    expect(msgs[2].quickReply).toBe(qr);
  });

  it("3 通 chain で msg1 と msg2 の両方に quickReply があれば、後ろ (msg2 の方) を tail へ移動", () => {
    // 仕様: 末尾から手前へ走査して「最初に見つかった」quickReply を tail へ
    // (= 後ろの方が優先される。chain 内で複数 QR は通常ありえないが、安全側で定義)
    const qr1 = { items: ["msg1-qr"] };
    const qr2 = { items: ["msg2-qr"] };
    const msgs: LineMsg[] = [
      { type: "text", text: "msg1", quickReply: qr1 },
      { type: "text", text: "msg2", quickReply: qr2 },
      { type: "text", text: "msg3" },
    ];
    moveQuickReplyToTail(msgs);
    expect(msgs[2].quickReply).toBe(qr2); // 後ろの方が tail へ
    expect(msgs[0].quickReply).toBe(qr1); // 前の方は残る (= LINE 側で表示されないが本 helper は触らない)
    expect(msgs[1].quickReply).toBeUndefined();
  });

  it("どのメッセージにも quickReply がなければ何も変わらない", () => {
    const msgs: LineMsg[] = [
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ];
    moveQuickReplyToTail(msgs);
    expect(msgs[0].quickReply).toBeUndefined();
    expect(msgs[1].quickReply).toBeUndefined();
  });
});
