// src/__tests__/chain-edit.test.ts
// 連続メッセージ編集の load 分割 / 保存 body 構築 / エラー文言（純関数）。
import { describe, it, expect } from "vitest";
import {
  loadChainSplit,
  buildChainSaveBody,
  chainErrorToMessage,
  sendSlotsForSave,
  type ChainMsgRow,
} from "@/app/oas/[id]/works/[workId]/messages/_chain-edit";
import { EMPTY_ADDITIONAL_SLOT, type AdditionalMessageSlot } from "@/app/oas/[id]/works/[workId]/messages/_form-helpers";

const row = (o: Partial<ChainMsgRow> & { id: string }): ChainMsgRow => ({ message_type: "text", body: "", ...o });
const slot = (o: Partial<AdditionalMessageSlot>): AdditionalMessageSlot => ({ ...EMPTY_ADDITIONAL_SLOT, ...o });

const slotMain = { work_id: "w", phase_id: "p", character_id: "c", kind: "normal" as const, sort_order: 0, is_active: true };

describe("loadChainSplit", () => {
  it("freeInput なし: head→next を sendSlots に詰め、応答なし", () => {
    const head = row({ id: "h", next_message_id: "s1" });
    const all = [head, row({ id: "s1", body: "2", next_message_id: "s2" }), row({ id: "s2", body: "3", next_message_id: null })];
    const r = loadChainSplit(head, all);
    expect(r.sendSlots.map((s) => s.existingId)).toEqual(["s1", "s2"]);
    expect(r.initialSendSlotIds).toEqual(["s1", "s2"]);
    expect(r.freeInputResponseId).toBeNull();
    expect(r.headFreeInputResponseId).toBeNull();
  });

  it("freeInput プロンプト(slot)で停止し、freeInputNext を応答として別枠化", () => {
    const head = row({ id: "h", next_message_id: "s1" });
    const all = [
      head,
      row({ id: "s1", body: "2", next_message_id: "s2", free_input_enabled: true, free_input_next_message_id: "resp" }),
      row({ id: "s2", body: "応答本体", next_message_id: null }),
    ];
    const r = loadChainSplit(head, all);
    expect(r.sendSlots.map((s) => s.existingId)).toEqual(["s1"]); // prompt まで（s2 応答は含めない）
    expect(r.freeInputResponseId).toBe("resp");
    expect(r.sendSlots[0].free_input_next_message_id).toBe("resp");
    expect(r.initialSendSlotIds).toEqual(["s1"]); // 応答は削除判定に含めない
  });

  it("legacy(freeInputEnabled=true / freeInputNext=null / next=応答) を応答として読み替える", () => {
    const head = row({ id: "h", next_message_id: "s1" });
    const all = [
      head,
      row({ id: "s1", body: "プロンプト", free_input_enabled: true, free_input_next_message_id: null, next_message_id: "resp" }),
      row({ id: "resp", body: "応答", next_message_id: null }),
    ];
    const r = loadChainSplit(head, all);
    expect(r.sendSlots.map((s) => s.existingId)).toEqual(["s1"]);
    expect(r.freeInputResponseId).toBe("resp"); // legacy next を応答とみなす
    expect(r.sendSlots[0].free_input_next_message_id).toBe("resp");
  });

  it("head 自体が freeInput プロンプト: sendSlots 空 + 応答 id", () => {
    const head = row({ id: "h", free_input_enabled: true, free_input_next_message_id: "resp" });
    const r = loadChainSplit(head, [head, row({ id: "resp", body: "応答", next_message_id: null })]);
    expect(r.sendSlots).toEqual([]);
    expect(r.freeInputResponseId).toBe("resp");
    expect(r.headFreeInputResponseId).toBe("resp");
  });

  it("別 work / 削除済み id を辿ったら停止", () => {
    const head = row({ id: "h", next_message_id: "missing" });
    const r = loadChainSplit(head, [head]);
    expect(r.sendSlots).toEqual([]);
  });
});

describe("buildChainSaveBody", () => {
  it("通常 chain: head + sendSlots を spec 化、応答なし", () => {
    const body = buildChainSaveBody({
      workId: "w", headId: "h", expectedHeadUpdatedAt: "2026-06-01T00:00:00.000Z",
      headBody: { body: "1通目" }, headFreeInputEnabled: false, headFreeInputNextMessageId: "",
      sendSlots: [slot({ existingId: "s1", body: "2" }), slot({ existingId: "s2", body: "3" })],
      slotMain, initialSendSlotIds: ["s1", "s2"],
    });
    expect(body.work_id).toBe("w");
    expect(body.head_id).toBe("h");
    expect(body.expected_head_updated_at).toBe("2026-06-01T00:00:00.000Z");
    expect(body.slots.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(body.free_input_response_id).toBeNull();
    expect(body.removed_message_ids).toEqual([]);
  });

  it("削除されたスロットが removed_message_ids に入る", () => {
    const body = buildChainSaveBody({
      workId: "w", headId: "h", headBody: {}, headFreeInputEnabled: false, headFreeInputNextMessageId: "",
      sendSlots: [slot({ existingId: "s1" })], // s2 が消えた
      slotMain, initialSendSlotIds: ["s1", "s2"],
    });
    expect(body.removed_message_ids).toEqual(["s2"]);
  });

  it("新規スロット(existingId なし)は id を持たない", () => {
    const body = buildChainSaveBody({
      workId: "w", headId: "h", headBody: {}, headFreeInputEnabled: false, headFreeInputNextMessageId: "",
      sendSlots: [slot({ body: "新規" })],
      slotMain, initialSendSlotIds: [],
    });
    expect(body.slots[0].id).toBeUndefined();
  });

  it("prompt slot の free_input_next_message_id が応答として API へ渡る", () => {
    const body = buildChainSaveBody({
      workId: "w", headId: "h", headBody: {}, headFreeInputEnabled: false, headFreeInputNextMessageId: "",
      sendSlots: [slot({ existingId: "s1", free_input_enabled: true, free_input_next_message_id: "resp" })],
      slotMain, initialSendSlotIds: ["s1"],
    });
    expect(body.free_input_response_id).toBe("resp");
  });

  it("head が prompt の場合は head の free_input_next_message_id が応答", () => {
    const body = buildChainSaveBody({
      workId: "w", headId: "h", headBody: { free_input_enabled: true }, headFreeInputEnabled: true, headFreeInputNextMessageId: "resp",
      sendSlots: [], slotMain, initialSendSlotIds: [],
    });
    expect(body.free_input_response_id).toBe("resp");
  });

  // new page は edit page と同じ buildChainSaveBody を通る（spec 生成ロジック共通）。
  describe("new page シナリオ（initialSendSlotIds=[] / 全 slot 新規）", () => {
    it("通常 head のみ: slots/removed 空", () => {
      const body = buildChainSaveBody({
        workId: "w", headId: "new-head", headBody: { body: "1通目" }, headFreeInputEnabled: false, headFreeInputNextMessageId: "",
        sendSlots: [], slotMain, initialSendSlotIds: [],
      });
      expect(body.head_id).toBe("new-head");
      expect(body.slots).toEqual([]);
      expect(body.removed_message_ids).toEqual([]);
      expect(body.free_input_response_id).toBeNull();
    });

    it("head + 新規 sendSlots: id なしスロット・removed なし", () => {
      const body = buildChainSaveBody({
        workId: "w", headId: "new-head", headBody: { body: "1" }, headFreeInputEnabled: false, headFreeInputNextMessageId: "",
        sendSlots: [slot({ body: "2" }), slot({ body: "3" })], slotMain, initialSendSlotIds: [],
      });
      expect(body.slots.length).toBe(2);
      expect(body.slots.every((s) => s.id === undefined)).toBe(true);
      expect(body.removed_message_ids).toEqual([]);
    });

    it("freeInput + 応答 / 応答なし(null) の両方を扱える", () => {
      const withResp = buildChainSaveBody({
        workId: "w", headId: "h", headBody: { body: "1" }, headFreeInputEnabled: false, headFreeInputNextMessageId: "",
        sendSlots: [slot({ body: "2", free_input_enabled: true, free_input_next_message_id: "resp" })],
        slotMain, initialSendSlotIds: [],
      });
      expect(withResp.free_input_response_id).toBe("resp");

      const noResp = buildChainSaveBody({
        workId: "w", headId: "h", headBody: { body: "1" }, headFreeInputEnabled: false, headFreeInputNextMessageId: "",
        sendSlots: [slot({ body: "2", free_input_enabled: true, free_input_next_message_id: "" })],
        slotMain, initialSendSlotIds: [],
      });
      expect(noResp.free_input_response_id).toBeNull(); // 応答なし許容
    });

    it("edit と new で同一 form 入力なら同一 spec（共通ロジック）", () => {
      const args = {
        workId: "w", headId: "h", headBody: { body: "1", quick_replies: [{ label: "a", action: "text", value: "x" }] },
        headFreeInputEnabled: false, headFreeInputNextMessageId: "",
        sendSlots: [slot({ existingId: "s1", body: "2" })], slotMain, initialSendSlotIds: ["s1"],
      };
      const a = buildChainSaveBody(args);
      const b = buildChainSaveBody(args);
      expect(a).toEqual(b);
    });
  });

  // ── #6-4c: chain から外す（detach）──────────────────────
  describe("detach（chainから外す）", () => {
    it("detachedMessageIds が body に入り、detach した id は removed に入らない", () => {
      // s2 を chain から外す（additionalMessages から除外 + detachedMessageIds に積む）
      const body = buildChainSaveBody({
        workId: "w", headId: "h", headBody: {}, headFreeInputEnabled: false, headFreeInputNextMessageId: "",
        sendSlots: [slot({ existingId: "s1" })], // s2 は外したので残っていない
        slotMain, initialSendSlotIds: ["s1", "s2"], detachedMessageIds: ["s2"],
      });
      expect(body.detached_message_ids).toEqual(["s2"]);
      expect(body.removed_message_ids).toEqual([]); // 外しただけ＝削除しない
      expect(body.slots.map((s) => s.id)).toEqual(["s1"]);
    });

    it("外していない欠落スロットは従来どおり removed に入る（detach と区別）", () => {
      // s2 を外す / s3 は単純削除（detach 指定なし）
      const body = buildChainSaveBody({
        workId: "w", headId: "h", headBody: {}, headFreeInputEnabled: false, headFreeInputNextMessageId: "",
        sendSlots: [slot({ existingId: "s1" })],
        slotMain, initialSendSlotIds: ["s1", "s2", "s3"], detachedMessageIds: ["s2"],
      });
      expect(body.detached_message_ids).toEqual(["s2"]);
      expect(body.removed_message_ids).toEqual(["s3"]);
    });

    it("detachedMessageIds 未指定なら空配列", () => {
      const body = buildChainSaveBody({
        workId: "w", headId: "h", headBody: {}, headFreeInputEnabled: false, headFreeInputNextMessageId: "",
        sendSlots: [slot({ existingId: "s1" })], slotMain, initialSendSlotIds: ["s1"],
      });
      expect(body.detached_message_ids).toEqual([]);
    });
  });
});

// まとめ送信廃止方針: 新規作成では 2通目以降を保存させない（保存ガード）。
describe("sendSlotsForSave（新規作成は 1通目のみ・保存ガード）", () => {
  const slots = [slot({ existingId: "s1" }), slot({ existingId: "s2" })];

  it("新規作成(isNew=true): スロットを空に丸める（2通目以降は保存されない）", () => {
    expect(sendSlotsForSave(true, slots)).toEqual([]);
    expect(sendSlotsForSave(true, [])).toEqual([]);
  });

  it("既存編集(isNew=false): スロットはそのまま保持（既存チェーンを壊さない）", () => {
    expect(sendSlotsForSave(false, slots)).toBe(slots);
    expect(sendSlotsForSave(false, slots).map((s) => s.existingId)).toEqual(["s1", "s2"]);
  });

  it("新規作成で state に 2通目が紛れ込んでも、buildChainSaveBody.slots は空（1通目のみ保存）", () => {
    const body = buildChainSaveBody({
      workId: "w", headId: "new-head", headBody: { body: "1通目" },
      headFreeInputEnabled: false, headFreeInputNextMessageId: "",
      // 新規ページは sendSlotsForSave(true, …) で必ず [] を渡す
      sendSlots: sendSlotsForSave(true, [slot({ body: "紛れ込んだ2通目" })]),
      slotMain, initialSendSlotIds: [],
    });
    expect(body.slots).toEqual([]);
    expect(body.removed_message_ids).toEqual([]); // 新規なので削除も発生しない
  });
});

describe("chainErrorToMessage", () => {
  it("既知コードは日本語に変換", () => {
    expect(chainErrorToMessage("REFERENCE_GUARD", "fb")).toContain("参照されている");
    expect(chainErrorToMessage("MULTIPLE_FREE_INPUT", "fb")).toContain("自由入力は1つ");
    expect(chainErrorToMessage("CONFLICT", "fb")).toContain("競合");
  });
  it("未知コードは fallback", () => {
    expect(chainErrorToMessage("WHATEVER", "fallback message")).toBe("fallback message");
    expect(chainErrorToMessage(null, "fb")).toBe("fb");
  });
});
