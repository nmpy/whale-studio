// src/__tests__/chain-import.test.ts
// 既存メッセージを chain に取り込む (#6-4d 相当・PR3a) の純関数。
import { describe, it, expect } from "vitest";
import {
  extractImportBlock, selectImportableHeads, validateImport, type ImportMessage,
} from "@/app/oas/[id]/works/[workId]/messages/_chain-import";

const m = (o: Partial<ImportMessage> & { id: string }): ImportMessage =>
  ({ workId: "w", isActive: true, body: o.id, message_type: "text", ...o });

describe("extractImportBlock", () => {
  it("head + next 継続ブロックを抽出（freeInputNext 先は含めない・freeInput で停止）", () => {
    const all = [
      m({ id: "B", next_message_id: "B2" }),
      m({ id: "B2", free_input_enabled: true, free_input_next_message_id: "resp", next_message_id: null }),
      m({ id: "resp", next_message_id: null }),
    ];
    const blk = extractImportBlock("B", all);
    expect(blk.blockIds).toEqual(["B", "B2"]);        // resp（freeInputNext 先）は含めない
    expect(blk.containsFreeInput).toBe(true);
    expect(blk.freeInputResponseId).toBe("resp");
  });

  it("freeInput なしブロックは next 終端まで", () => {
    const all = [m({ id: "D", next_message_id: "D2" }), m({ id: "D2", next_message_id: "D3" }), m({ id: "D3", next_message_id: null })];
    const blk = extractImportBlock("D", all);
    expect(blk.blockIds).toEqual(["D", "D2", "D3"]);
    expect(blk.containsFreeInput).toBe(false);
  });
});

describe("selectImportableHeads", () => {
  const all = [
    m({ id: "A", next_message_id: "A2" }),   // target head
    m({ id: "A2", next_message_id: null }),  // target continuation
    m({ id: "B", next_message_id: null }),   // standalone head → 候補
    m({ id: "Bc", next_message_id: null }),  // continuation of nobody? standalone head → 候補
    m({ id: "cont", next_message_id: null }),
    m({ id: "P", next_message_id: "cont" }), // P→cont なので cont は continuation（候補外）
    m({ id: "qref", next_message_id: null, }),
    m({ id: "Q", next_message_id: null, quick_replies: [{ target_type: "message", target_message_id: "qref" }] }), // Q→qref(QR)
  ];
  it("standalone entry head のみ候補（target chain / continuation を除外）", () => {
    const cands = selectImportableHeads(all, { targetHeadId: "A", targetChainIds: ["A", "A2"], workId: "w" });
    const ids = cands.map((c) => c.id).sort();
    expect(ids).toContain("B");
    expect(ids).not.toContain("A");    // target head
    expect(ids).not.toContain("A2");   // target chain
    expect(ids).not.toContain("cont"); // continuation（P から参照）
  });
  it("QR で参照される standalone head は候補に出るが qrReferenced=true", () => {
    const cands = selectImportableHeads(all, { targetHeadId: "A", targetChainIds: ["A", "A2"], workId: "w" });
    const qref = cands.find((c) => c.id === "qref");
    expect(qref).toBeTruthy();
    expect(qref!.qrReferenced).toBe(true);
    expect(qref!.referrerKinds).toContain("qr_target");
  });
});

describe("validateImport", () => {
  const base = [
    m({ id: "A", next_message_id: "A2" }), m({ id: "A2", next_message_id: null }),
    m({ id: "B", next_message_id: "B2" }), m({ id: "B2", next_message_id: null }),
  ];
  const opts = { targetHeadId: "A", targetChainIds: ["A", "A2"], appendAtEnd: true, allMessages: base, workId: "w" };

  it("1/2/3. standalone head B を取り込め、継続ブロック(B,B2)も保持・entry head から外れる想定", () => {
    const r = validateImport({ ...opts, headId: "B" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.block.blockIds).toEqual(["B", "B2"]); // B の継続も取り込む
    // 取り込めば B は target の continuation になる → entry head ではなくなる（保存後 verify で確認する想定）
  });

  it("4. 他 chain 途中の message は取り込み不可（IS_CONTINUATION）", () => {
    const all = [...base, m({ id: "P", next_message_id: "child" }), m({ id: "child", next_message_id: null })];
    const r = validateImport({ ...opts, allMessages: all, headId: "child" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("IS_CONTINUATION");
  });

  it("5. 同一 chain 内の message は取り込み不可（IN_TARGET_CHAIN）", () => {
    const r = validateImport({ ...opts, headId: "A2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("IN_TARGET_CHAIN");
  });

  it("6. cross-work は取り込み不可", () => {
    const all = [...base, m({ id: "X", workId: "other", next_message_id: null })];
    const r = validateImport({ ...opts, allMessages: all, headId: "X" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CROSS_WORK");
  });

  it("7/8. freeInput を含むブロックは末尾のみ・freeInputNext 先は含まれない", () => {
    const all = [
      m({ id: "A", next_message_id: "A2" }), m({ id: "A2", next_message_id: null }),
      m({ id: "F", free_input_enabled: true, free_input_next_message_id: "fresp", next_message_id: null }),
      m({ id: "fresp", next_message_id: null }),
    ];
    const o = { targetHeadId: "A", targetChainIds: ["A", "A2"], allMessages: all, workId: "w" };
    expect(validateImport({ ...o, headId: "F", appendAtEnd: false }).ok).toBe(false); // 末尾以外は不可
    const r = validateImport({ ...o, headId: "F", appendAtEnd: true });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.block.blockIds).toEqual(["F"]); expect(r.block.blockIds).not.toContain("fresp"); }
  });

  it("9. QR target で参照される standalone head は取り込めるが warning 付き", () => {
    const all = [...base, m({ id: "Q", next_message_id: null, quick_replies: [{ target_type: "message", target_message_id: "qonly" }] }), m({ id: "qonly", next_message_id: null })];
    const r = validateImport({ ...opts, allMessages: all, headId: "qonly" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => w.includes("QR"))).toBe(true);
  });

  it("10. 取り込みブロックが target と重複（循環）するケースは拒否", () => {
    // B→A2（target 内）に繋がっているブロックは取り込むと循環 → BLOCK_OVERLAPS_TARGET
    const all = [m({ id: "A", next_message_id: "A2" }), m({ id: "A2", next_message_id: null }), m({ id: "B", next_message_id: "A2" })];
    const r = validateImport({ targetHeadId: "A", targetChainIds: ["A", "A2"], appendAtEnd: true, allMessages: all, workId: "w", headId: "B" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BLOCK_OVERLAPS_TARGET");
  });

  it("12. detached / removed と取り込み id が衝突するケースは拒否", () => {
    const r = validateImport({ ...opts, headId: "B", detachedMessageIds: ["B"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BLOCK_OVERLAPS_TARGET");
  });

  it("5通超え: freeInput なしで合計>5 は warning（拒否はしない）", () => {
    const all = [
      m({ id: "A", next_message_id: "A2" }), m({ id: "A2", next_message_id: "A3" }), m({ id: "A3", next_message_id: null }),
      m({ id: "B", next_message_id: "B2" }), m({ id: "B2", next_message_id: "B3" }), m({ id: "B3", next_message_id: null }),
    ];
    const r = validateImport({ targetHeadId: "A", targetChainIds: ["A", "A2", "A3"], appendAtEnd: true, allMessages: all, workId: "w", headId: "B", targetSendCount: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => w.includes("5通"))).toBe(true);
  });
});
