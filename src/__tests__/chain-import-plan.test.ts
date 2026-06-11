// src/__tests__/chain-import-plan.test.ts
// 取り込み反映の純関数（PR3b-1）: before/after シミュレート・block→slots 変換・cross-phase 警告。
import { describe, it, expect } from "vitest";
import {
  buildImportedSendOrder, simulateImportedMessages, importBeforeAfterSummary,
  importBlockToSlots, extractImportBlock, validateImport, insertImportedSlots, toImportMessage, type ImportMessage,
} from "@/app/oas/[id]/works/[workId]/messages/_chain-import";

const m = (o: Partial<ImportMessage> & { id: string }): ImportMessage =>
  ({ workId: "w", phaseId: "p", isActive: true, body: o.id, message_type: "text", sort_order: 0, created_at: "2026-01-01T00:00:00Z", ...o });

describe("buildImportedSendOrder", () => {
  it("target sendChain に block を index 位置で挿入する", () => {
    expect(buildImportedSendOrder(["A", "a2"], 2, ["B", "b2"])).toEqual(["A", "a2", "B", "b2"]); // 末尾
    expect(buildImportedSendOrder(["A", "a2"], 1, ["X"])).toEqual(["A", "X", "a2"]);            // 中間
  });
});

describe("simulateImportedMessages（1. after を pure に合成）", () => {
  it("sendOrder に沿って next を書き換える（freeInput は next=null）", () => {
    const all = [m({ id: "A", next_message_id: "a2" }), m({ id: "a2", next_message_id: null }), m({ id: "B", next_message_id: "b2" }), m({ id: "b2", next_message_id: null })];
    const sim = simulateImportedMessages(all, ["A", "a2", "B", "b2"]);
    const byId = Object.fromEntries(sim.map((x) => [x.id, x]));
    expect(byId["a2"].next_message_id).toBe("B"); // a2 → B（取り込み連結）
    expect(byId["B"].next_message_id).toBe("b2");
    expect(byId["b2"].next_message_id).toBeNull();
  });
  it("freeInput プロンプトは next=null に正規化される", () => {
    const all = [m({ id: "A", next_message_id: null }), m({ id: "F", free_input_enabled: true, next_message_id: "x" })];
    const sim = simulateImportedMessages(all, ["A", "F"]);
    expect(sim.find((x) => x.id === "F")!.next_message_id).toBeNull();
  });
});

describe("importBeforeAfterSummary（2/3/4. entry head・QR・freeInput 停止の before→after）", () => {
  it("2. 通常ブロック取り込みで entry head 数が減る", () => {
    const all = [
      m({ id: "A", next_message_id: "a2" }), m({ id: "a2", next_message_id: null }),
      m({ id: "B", next_message_id: "b2" }), m({ id: "b2", next_message_id: null }),
      m({ id: "E", next_message_id: null }),
    ];
    const order = buildImportedSendOrder(["A", "a2"], 2, ["B", "b2"]); // A の末尾に B を取り込み
    const r = importBeforeAfterSummary(all, "p", order);
    expect(r.before.entryHeadCount).toBe(3); // A, B, E
    expect(r.after.entryHeadCount).toBe(2);  // A(+B), E
  });

  it("3. QR 参照あり entry head を取り込むと qrHeadCount が減る", () => {
    const all = [
      m({ id: "A", next_message_id: "a2" }), m({ id: "a2", next_message_id: null }),
      m({ id: "Q", next_message_id: null, quick_replies: [{ target_type: "message", target_message_id: "qonly" }] }),
      m({ id: "qonly", next_message_id: null }), // QR で参照される standalone head
    ];
    const order = buildImportedSendOrder(["A", "a2"], 2, ["qonly"]);
    const r = importBeforeAfterSummary(all, "p", order);
    expect(r.before.qrHeadCount).toBe(1); // qonly が QR 参照 entry head
    expect(r.after.qrHeadCount).toBe(0);  // 取り込みで entry head から外れる
  });

  it("4. freeInput ブロックを末尾取り込みすると stoppedAtFreeInput が変わる", () => {
    const all = [
      m({ id: "A", next_message_id: "a2" }), m({ id: "a2", next_message_id: null }),
      m({ id: "F", free_input_enabled: true, free_input_next_message_id: "fr", next_message_id: null }),
      m({ id: "fr", phaseId: "other", next_message_id: null }), // 応答は別 phase（入場対象外）
    ];
    // before: A の chain に freeInput 無し → 但し F も同 phase head なので before でも F で停止しうる。
    // ここでは A 単独 phase（F を別 phase に）で before=null を作る
    const all2 = all.map((x) => (x.id === "F" ? { ...x, phaseId: "p" } : x));
    const order = buildImportedSendOrder(["A", "a2"], 2, ["F"]);
    const r = importBeforeAfterSummary(all2, "p", order);
    expect(r.after.stoppedAtFreeInputId).toBe("F"); // 取り込み後は F の freeInput で停止
  });
});

describe("importBlockToSlots（5/6. block → existingId 付き slots・freeInputResponse 別枠）", () => {
  it("5. block を existingId 付き slots に変換する", () => {
    const all = [m({ id: "B", next_message_id: "b2" }), m({ id: "b2", next_message_id: null })];
    const block = extractImportBlock("B", all);
    const { slots } = importBlockToSlots(block, all);
    expect(slots.map((s) => s.existingId)).toEqual(["B", "b2"]);
  });

  it("6. freeInput ブロックの応答(freeInputNext 先)は slots に含めず別枠で返す", () => {
    const all = [
      m({ id: "B", next_message_id: "bfi" }),
      m({ id: "bfi", free_input_enabled: true, free_input_next_message_id: "resp", next_message_id: null }),
      m({ id: "resp", next_message_id: null }),
    ];
    const block = extractImportBlock("B", all);
    const { slots, freeInputResponseId } = importBlockToSlots(block, all);
    expect(slots.map((s) => s.existingId)).toEqual(["B", "bfi"]); // resp は含めない
    expect(freeInputResponseId).toBe("resp");
    const fiSlot = slots.find((s) => s.existingId === "bfi")!;
    expect(fiSlot.free_input_enabled).toBe(true);
    expect(fiSlot.free_input_next_message_id).toBe("resp"); // 応答 id は select に復元（別枠）
  });
});

describe("insertImportedSlots / toImportMessage（form 反映・正規化）", () => {
  it("additionalMessages の指定位置に取り込みスロットを挿入する", () => {
    const cur = [{ existingId: "s1" }, { existingId: "s2" }];
    const imported = [{ existingId: "i1" }, { existingId: "i2" }];
    expect(insertImportedSlots(cur, 1, imported).map((s) => s.existingId)).toEqual(["s1", "i1", "i2", "s2"]);
    expect(insertImportedSlots(cur, 2, imported).map((s) => s.existingId)).toEqual(["s1", "s2", "i1", "i2"]); // 末尾
  });
  it("snake_case メッセージを ImportMessage に正規化（work_id→workId 等）", () => {
    const im = toImportMessage({ id: "x", work_id: "w", phase_id: "p", is_active: true, next_message_id: "y", free_input_enabled: true });
    expect(im).toMatchObject({ id: "x", workId: "w", phaseId: "p", isActive: true, next_message_id: "y", free_input_enabled: true });
  });
});

describe("validateImport（7/8/9. 5通超え・別phase・freeInput非末尾）", () => {
  const baseAllSamePhase = [
    m({ id: "A", next_message_id: "a2" }), m({ id: "a2", next_message_id: "a3" }), m({ id: "a3", next_message_id: null }),
    m({ id: "B", next_message_id: "b2" }), m({ id: "b2", next_message_id: "b3" }), m({ id: "b3", next_message_id: null }),
  ];
  it("7. freeInput なしで合計 >5 → 5通超え warning（拒否しない）", () => {
    const r = validateImport({ headId: "B", targetHeadId: "A", targetChainIds: ["A", "a2", "a3"], appendAtEnd: true, allMessages: baseAllSamePhase, workId: "w", targetSendCount: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => w.includes("5通"))).toBe(true);
  });

  it("8. 別 phase の standalone entry head 取り込みは warning が出る", () => {
    const all = [
      m({ id: "A", phaseId: "p", next_message_id: "a2" }), m({ id: "a2", phaseId: "p", next_message_id: null }),
      m({ id: "X", phaseId: "other", next_message_id: null }), // 別 phase の head
    ];
    const r = validateImport({ headId: "X", targetHeadId: "A", targetChainIds: ["A", "a2"], appendAtEnd: true, allMessages: all, workId: "w", targetPhaseId: "p" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => w.includes("別フェーズ"))).toBe(true);
  });

  it("9. freeInput を含むブロックを非末尾に取り込もうとすると不可", () => {
    const all = [
      m({ id: "A", next_message_id: "a2" }), m({ id: "a2", next_message_id: null }),
      m({ id: "F", free_input_enabled: true, free_input_next_message_id: "fr", next_message_id: null }),
    ];
    const r = validateImport({ headId: "F", targetHeadId: "A", targetChainIds: ["A", "a2"], appendAtEnd: false, allMessages: all, workId: "w" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FREE_INPUT_NOT_LAST");
  });
});
