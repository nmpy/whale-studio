// src/__tests__/chain-refs.test.ts
// メッセージの逆参照可視化（findReferrers 純関数・#6-4a）。
import { describe, it, expect } from "vitest";
import { findReferrers, REFERRER_KIND_LABEL, type RefMessage } from "@/app/oas/[id]/works/[workId]/messages/_chain-refs";

const m = (o: Partial<RefMessage> & { id: string }): RefMessage => ({ body: "", message_type: "text", ...o });

describe("findReferrers", () => {
  it("nextMessageId の参照を検出する", () => {
    const all = [m({ id: "a", next_message_id: "target" }), m({ id: "target" })];
    const r = findReferrers("target", all);
    expect(r).toEqual([{ referrerId: "a", referrerLabel: "(text)", kind: "next" }]);
  });

  it("freeInputNextMessageId の参照を検出する", () => {
    const all = [m({ id: "a", body: "プロンプト", free_input_next_message_id: "target" }), m({ id: "target" })];
    const r = findReferrers("target", all);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ referrerId: "a", kind: "freeInputNext" });
    expect(r[0].referrerLabel).toBe("プロンプト");
  });

  it("QR target_message_id の参照を検出する", () => {
    const all = [
      m({ id: "a", quick_replies: [{ label: "見る", action: "next", target_message_id: "target" }] }),
      m({ id: "target" }),
    ];
    const r = findReferrers("target", all);
    expect(r).toEqual([{ referrerId: "a", referrerLabel: "(text)", kind: "qr_target" }]);
  });

  it("QR response_message_id の参照を検出する", () => {
    const all = [
      m({ id: "a", quick_replies: [{ label: "へえ", action: "next", response_message_id: "target" }] }),
      m({ id: "target" }),
    ];
    const r = findReferrers("target", all);
    expect(r).toEqual([{ referrerId: "a", referrerLabel: "(text)", kind: "qr_response" }]);
  });

  it("複数参照を検出する（同一メッセージが next と QR の両方で参照）", () => {
    const all = [
      m({ id: "a", next_message_id: "target", quick_replies: [{ target_message_id: "target" }] }),
      m({ id: "b", free_input_next_message_id: "target" }),
      m({ id: "target" }),
    ];
    const r = findReferrers("target", all);
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.kind).sort()).toEqual(["freeInputNext", "next", "qr_target"]);
  });

  it("参照なしの場合は空配列", () => {
    const all = [m({ id: "a", next_message_id: "x" }), m({ id: "target" })];
    expect(findReferrers("target", all)).toEqual([]);
  });

  it("自分自身の参照は含めない（仕様）", () => {
    // target が自分自身を next / QR で指していても参照元には出さない
    const all = [m({ id: "target", next_message_id: "target", quick_replies: [{ target_message_id: "target" }] })];
    expect(findReferrers("target", all)).toEqual([]);
  });

  it("壊れた QR JSON / 想定外形式でも落ちない", () => {
    const all: RefMessage[] = [
      m({ id: "a", quick_replies: "{ this is not valid json" }),
      m({ id: "b", quick_replies: "not-an-array" }),
      m({ id: "c", quick_replies: 12345 }),
      m({ id: "d", quick_replies: [null, "str", { target_message_id: "target" }] }),
      m({ id: "target" }),
    ];
    const r = findReferrers("target", all);
    expect(r).toEqual([{ referrerId: "d", referrerLabel: "(text)", kind: "qr_target" }]);
  });

  it("quick_replies が JSON 文字列でも検出できる", () => {
    const all = [
      m({ id: "a", quick_replies: JSON.stringify([{ target_message_id: "target" }]) }),
      m({ id: "target" }),
    ];
    expect(findReferrers("target", all)).toHaveLength(1);
  });

  it("REFERRER_KIND_LABEL は4種の日本語ラベルを持つ", () => {
    expect(REFERRER_KIND_LABEL.next).toContain("連続");
    expect(REFERRER_KIND_LABEL.freeInputNext).toContain("自由入力");
    expect(REFERRER_KIND_LABEL.qr_target).toContain("クイックリプライ分岐");
    expect(REFERRER_KIND_LABEL.qr_response).toContain("クイックリプライ応答");
  });
});
