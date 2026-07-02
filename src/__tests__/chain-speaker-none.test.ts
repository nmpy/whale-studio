/**
 * chain-speaker-none.test.ts
 *
 * 2通目以降（チェーン）の発話キャラクター選択に「キャラクターを指定しない」を追加した対応の検証。
 *   ""                 = 1通目を引き継ぐ（従来・新規既定）
 *   CHAIN_SPEAKER_NONE = 指定しない（保存時 null）
 *   <characterId>      = 指定キャラ
 */
import { describe, it, expect } from "vitest";
import {
  additionalSlotToMsgBody,
  msgToAdditionalSlot,
  EMPTY_ADDITIONAL_SLOT,
  CHAIN_SPEAKER_NONE,
  type AdditionalMessageSlot,
} from "@/app/oas/[id]/works/[workId]/messages/_form-helpers";

const slot = (o: Partial<AdditionalMessageSlot> = {}): AdditionalMessageSlot => ({ ...EMPTY_ADDITIONAL_SLOT, ...o });
const mainWith = (character_id: string | null) => ({
  work_id: "w1", phase_id: "p1", character_id, kind: "normal" as const, sort_order: 0, is_active: true,
});

describe("additionalSlotToMsgBody — 発話キャラクターの三分岐（保存値）", () => {
  it("1: 1通目=A / 2通目=引き継ぐ('') → A を保存", () => {
    const body = additionalSlotToMsgBody(slot({ message_type: "text", body: "x", character_id: "" }), mainWith("A"));
    expect(body.character_id).toBe("A");
  });

  it("2: 1通目=A / 2通目=指定しない → null を保存", () => {
    const body = additionalSlotToMsgBody(slot({ message_type: "text", body: "x", character_id: CHAIN_SPEAKER_NONE }), mainWith("A"));
    expect(body.character_id).toBeNull();
  });

  it("3: 1通目=A / 2通目=B 指定 → B を保存", () => {
    const body = additionalSlotToMsgBody(slot({ message_type: "text", body: "x", character_id: "B" }), mainWith("A"));
    expect(body.character_id).toBe("B");
  });

  it("4: 1通目=null / 2通目=引き継ぐ('') → null を保存", () => {
    const body = additionalSlotToMsgBody(slot({ message_type: "text", body: "x", character_id: "" }), mainWith(null));
    expect(body.character_id).toBeNull();
  });

  it("sentinel はDBに保存されない（必ず null 化）", () => {
    const body = additionalSlotToMsgBody(slot({ message_type: "text", body: "x", character_id: CHAIN_SPEAKER_NONE }), mainWith("A"));
    expect(body.character_id).not.toBe(CHAIN_SPEAKER_NONE);
    expect(body.character_id).toBeNull();
  });
});

describe("新規 slot / 復元（msgToAdditionalSlot）", () => {
  it("5: 新規 slot の初期 character_id は '' （= 1通目を引き継ぐ）", () => {
    expect(EMPTY_ADDITIONAL_SLOT.character_id).toBe("");
  });

  it("6: 編集復元 character_id=null → CHAIN_SPEAKER_NONE（指定しない）", () => {
    const s = msgToAdditionalSlot({ id: "m", character_id: null, message_type: "text" });
    expect(s.character_id).toBe(CHAIN_SPEAKER_NONE);
  });

  it("7: 編集復元 character_id=B → B（指定キャラ）", () => {
    const s = msgToAdditionalSlot({ id: "m", character_id: "B", message_type: "text" });
    expect(s.character_id).toBe("B");
  });

  it("復元→保存の往復: null → 指定しない → null（値が保たれる）", () => {
    const s = msgToAdditionalSlot({ id: "m", character_id: null, message_type: "text", body: "x" });
    const body = additionalSlotToMsgBody(s, mainWith("A"));
    expect(body.character_id).toBeNull();
  });
});
