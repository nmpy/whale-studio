// src/__tests__/chain-plan.test.ts
// 連続メッセージ一括保存の計画＋検証（planChainSave 純関数）。
import { describe, it, expect } from "vitest";
import { planChainSave, type ChainSaveSpec, type WorkMessageRef } from "@/lib/chain-plan";

const ok = (r: ReturnType<typeof planChainSave>) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};

describe("planChainSave", () => {
  it("head + slots: send chain を計画し sendCount を返す（freeInput なし）", () => {
    const spec: ChainSaveSpec = { headId: "h", sendSlots: [{ id: "s1" }, { id: "s2" }] };
    const r = ok(planChainSave(spec, []));
    expect(r.sendCount).toBe(3);
    expect(r.freeInputAt).toBeNull();
    expect(r.freeInputResponseId).toBeNull();
    expect(r.exceedsReplyLimit).toBe(false);
  });

  it("中間スロット削除（= sendSlots から欠落）でも残りを連結（連続性は呼び出し側の順序に従う）", () => {
    // s2 を削除 → sendSlots は [s1, s3] のみ。removedMessageIds=[s2]
    const spec: ChainSaveSpec = { headId: "h", sendSlots: [{ id: "s1" }, { id: "s3" }], removedMessageIds: ["s2"] };
    const work: WorkMessageRef[] = [
      { id: "h", nextMessageId: "s1" },
      { id: "s1", nextMessageId: "s2" },
      { id: "s2", nextMessageId: "s3" },
      { id: "s3", nextMessageId: null },
    ];
    const r = ok(planChainSave(spec, work));
    expect(r.sendCount).toBe(3);
    expect(r.removedMessageIds).toEqual(["s2"]);
  });

  it("freeInput プロンプト（末尾）: freeInputAt を返す（応答なし=null許容）", () => {
    const spec: ChainSaveSpec = { headId: "h", sendSlots: [{ id: "s1" }, { id: "s2", freeInputEnabled: true }] };
    const r = ok(planChainSave(spec, []));
    expect(r.freeInputAt).toBe(2); // head=0, s1=1, s2=2
    expect(r.freeInputResponseId).toBeNull();
  });

  it("head 自体が freeInput（slots なし）", () => {
    const spec: ChainSaveSpec = { headId: "h", headFreeInputEnabled: true, sendSlots: [] };
    const r = ok(planChainSave(spec, []));
    expect(r.freeInputAt).toBe(0);
    expect(r.sendCount).toBe(1);
  });

  it("freeInput + 応答: freeInputResponseId を返す（正規化対象）", () => {
    const spec: ChainSaveSpec = { headId: "h", sendSlots: [{ id: "s1", freeInputEnabled: true }], freeInputResponseId: "resp" };
    const r = ok(planChainSave(spec, []));
    expect(r.freeInputAt).toBe(1);
    expect(r.freeInputResponseId).toBe("resp");
  });

  it("freeInputResponse=null は許容（freeInput受付のみ）", () => {
    const spec: ChainSaveSpec = { headId: "h", sendSlots: [{ id: "s1", freeInputEnabled: true }], freeInputResponseId: null };
    const r = ok(planChainSave(spec, []));
    expect(r.freeInputResponseId).toBeNull();
  });

  it("複数 freeInput は拒否（MULTIPLE_FREE_INPUT）", () => {
    const spec: ChainSaveSpec = { headId: "h", headFreeInputEnabled: true, sendSlots: [{ id: "s1", freeInputEnabled: true }] };
    const r = planChainSave(spec, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MULTIPLE_FREE_INPUT");
  });

  it("freeInput が末尾以外なら拒否（FREE_INPUT_NOT_LAST）", () => {
    const spec: ChainSaveSpec = { headId: "h", sendSlots: [{ id: "s1", freeInputEnabled: true }, { id: "s2" }] };
    const r = planChainSave(spec, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FREE_INPUT_NOT_LAST");
  });

  it("応答指定があるが freeInput プロンプトが無ければ拒否（RESPONSE_WITHOUT_PROMPT）", () => {
    const spec: ChainSaveSpec = { headId: "h", sendSlots: [{ id: "s1" }], freeInputResponseId: "resp" };
    const r = planChainSave(spec, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("RESPONSE_WITHOUT_PROMPT");
  });

  it("send chain 内の id 重複は拒否（DUPLICATE_MESSAGE）", () => {
    const spec: ChainSaveSpec = { headId: "h", sendSlots: [{ id: "s1" }, { id: "h" }] };
    const r = planChainSave(spec, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DUPLICATE_MESSAGE");
  });

  it("応答が send chain に含まれる場合は拒否（RESPONSE_IN_SEND_CHAIN）", () => {
    const spec: ChainSaveSpec = { headId: "h", sendSlots: [{ id: "s1", freeInputEnabled: true }], freeInputResponseId: "h" };
    const r = planChainSave(spec, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("RESPONSE_IN_SEND_CHAIN");
  });

  it("削除対象が chain 外から参照されている場合は拒否（REFERENCE_GUARD）", () => {
    const spec: ChainSaveSpec = { headId: "h", sendSlots: [{ id: "s1" }], removedMessageIds: ["old"] };
    const work: WorkMessageRef[] = [
      { id: "h", nextMessageId: "s1" },
      { id: "s1", nextMessageId: null },
      { id: "outside", nextMessageId: "old" }, // chain 外から参照
      { id: "old", nextMessageId: null },
    ];
    const r = planChainSave(spec, work);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("REFERENCE_GUARD");
      expect(r.detail).toMatchObject({ removed: "old", referencedBy: "outside" });
    }
  });

  it("削除対象が QR target から参照されている場合も拒否（REFERENCE_GUARD）", () => {
    const spec: ChainSaveSpec = { headId: "h", sendSlots: [], removedMessageIds: ["old"] };
    const work: WorkMessageRef[] = [
      { id: "h", nextMessageId: null },
      { id: "qrsrc", quickReplies: JSON.stringify([{ target_message_id: "old" }]) },
      { id: "old", nextMessageId: null },
    ];
    const r = planChainSave(spec, work);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("REFERENCE_GUARD");
  });

  it("削除対象が chain 内（head/slot）からのみ参照されているなら許可（再リンクで解消）", () => {
    const spec: ChainSaveSpec = { headId: "h", sendSlots: [{ id: "s1" }], removedMessageIds: ["old"] };
    const work: WorkMessageRef[] = [
      { id: "h", nextMessageId: "old" }, // chain 内から old を参照（保存で書き換わる）
      { id: "old", nextMessageId: "s1" },
      { id: "s1", nextMessageId: null },
    ];
    const r = planChainSave(spec, work);
    expect(r.ok).toBe(true);
  });

  it("削除対象が chain 本体に含まれていれば拒否（REMOVED_IN_CHAIN）", () => {
    const spec: ChainSaveSpec = { headId: "h", sendSlots: [{ id: "s1" }], removedMessageIds: ["s1"] };
    const r = planChainSave(spec, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("REMOVED_IN_CHAIN");
  });

  it("5通超えは拒否しないが exceedsReplyLimit=true", () => {
    const spec: ChainSaveSpec = { headId: "h", sendSlots: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }] };
    const r = ok(planChainSave(spec, []));
    expect(r.sendCount).toBe(6);
    expect(r.exceedsReplyLimit).toBe(true);
  });

  it("ちょうど5通は exceedsReplyLimit=false", () => {
    const spec: ChainSaveSpec = { headId: "h", sendSlots: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] };
    const r = ok(planChainSave(spec, []));
    expect(r.sendCount).toBe(5);
    expect(r.exceedsReplyLimit).toBe(false);
  });
});
