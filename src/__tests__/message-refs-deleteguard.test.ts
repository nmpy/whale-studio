// src/__tests__/message-refs-deleteguard.test.ts
// 削除ガード用の純関数（computeDeleteSet / findExternalReferrers・#6-4b）。
import { describe, it, expect } from "vitest";
import { computeDeleteSet, findExternalReferrers, type RefMessage } from "@/lib/message-refs";

const m = (o: Partial<RefMessage> & { id: string }): RefMessage => ({ body: "", message_type: "text", ...o });

describe("computeDeleteSet", () => {
  it("削除対象集合を計算できる（root + next 連鎖）", () => {
    const all = [
      m({ id: "A", next_message_id: "B" }),
      m({ id: "B", next_message_id: "C" }),
      m({ id: "C", next_message_id: null }),
      m({ id: "X" }),
    ];
    expect(computeDeleteSet("A", all)).toEqual(["A", "B", "C"]);
  });
  it("循環でも停止する", () => {
    const all = [m({ id: "A", next_message_id: "B" }), m({ id: "B", next_message_id: "A" })];
    expect(computeDeleteSet("A", all)).toEqual(["A", "B"]);
  });
  it("cap を超える後続は含めない", () => {
    const all = Array.from({ length: 15 }, (_, i) => m({ id: `n${i}`, next_message_id: i < 14 ? `n${i + 1}` : null }));
    expect(computeDeleteSet("n0", all, 3)).toEqual(["n0", "n1", "n2", "n3"]); // root + 3
  });
});

describe("findExternalReferrers", () => {
  const set = ["A", "B", "C"]; // A→B→C をまとめて削除

  it("集合内部の next 参照はブロックしない（A→B→C）", () => {
    const all = [
      m({ id: "A", next_message_id: "B" }),
      m({ id: "B", next_message_id: "C" }),
      m({ id: "C" }),
    ];
    expect(findExternalReferrers(set, all)).toEqual([]);
  });

  it("集合外からの nextMessageId 参照を検出する", () => {
    const all = [m({ id: "A" }), m({ id: "B" }), m({ id: "C" }), m({ id: "X", next_message_id: "B" })];
    const r = findExternalReferrers(set, all);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ referrerId: "X", kind: "next", targetId: "B" });
  });

  it("集合外からの freeInputNextMessageId 参照を検出する", () => {
    const all = [m({ id: "A" }), m({ id: "X", free_input_next_message_id: "A" })];
    const r = findExternalReferrers(set, all);
    expect(r[0]).toMatchObject({ referrerId: "X", kind: "freeInputNext", targetId: "A" });
  });

  it("集合外からの QR target_message_id 参照を検出する", () => {
    const all = [m({ id: "A" }), m({ id: "X", quick_replies: [{ target_message_id: "C" }] })];
    const r = findExternalReferrers(set, all);
    expect(r[0]).toMatchObject({ referrerId: "X", kind: "qr_target", targetId: "C" });
  });

  it("集合外からの QR response_message_id 参照を検出する", () => {
    const all = [m({ id: "A" }), m({ id: "X", quick_replies: [{ response_message_id: "B" }] })];
    const r = findExternalReferrers(set, all);
    expect(r[0]).toMatchObject({ referrerId: "X", kind: "qr_response", targetId: "B" });
  });

  it("後続chainへの外部参照を検出する（X→C、C は後続）", () => {
    const all = [
      m({ id: "A", next_message_id: "B" }), m({ id: "B", next_message_id: "C" }), m({ id: "C" }),
      m({ id: "X", next_message_id: "C" }),
    ];
    const r = findExternalReferrers(set, all);
    expect(r.map((x) => x.targetId)).toEqual(["C"]);
  });

  it("壊れた quick_replies でも落ちない", () => {
    const all = [
      m({ id: "A" }),
      m({ id: "X", quick_replies: "{{bad json" }),
      m({ id: "Y", quick_replies: 999 }),
      m({ id: "Z", quick_replies: [null, { target_message_id: "A" }] }),
    ];
    const r = findExternalReferrers(set, all);
    expect(r).toEqual([{ referrerId: "Z", referrerLabel: "(text)", kind: "qr_target", targetId: "A" }]);
  });
});
