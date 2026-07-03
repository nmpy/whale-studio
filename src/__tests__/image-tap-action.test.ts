/**
 * src/__tests__/image-tap-action.test.ts
 *
 * 画像メッセージのタップ設定を「タップ時の動作」(image_action) に一本化した際の
 * データ層（連続メッセージ slot の load/save + 旧 tap_* 後方互換）を検証する。
 *
 * - 旧「画像タップ時の遷移先」(tap_url / tap_destination_id) は読込時に「URLを開く(uri)」へ移行。
 * - 保存は image_action_type / image_action_text / image_action_url（既存カラム・新規 migration なし）。
 * - runtime（Flex 生成）は既存の buildImageActionFlex を流用（本PRでは不変）。
 */
import { describe, it, expect } from "vitest";
import {
  msgToAdditionalSlot,
  additionalSlotToMsgBody,
  EMPTY_ADDITIONAL_SLOT,
  type AdditionalMessageSlot,
} from "@/app/oas/[id]/works/[workId]/messages/_form-helpers";

const imageSlot = (over: Partial<AdditionalMessageSlot> = {}): AdditionalMessageSlot => ({
  ...EMPTY_ADDITIONAL_SLOT,
  message_type: "image",
  asset_url: "https://cdn.example.com/a.png",
  ...over,
});

const main = {
  work_id: "w1", phase_id: "p1", character_id: null,
  kind: "normal" as const, sort_order: 0, is_active: true,
};

describe("auto_transition_phase_id — chain child(slot) の保存・読み戻し", () => {
  it("msgToAdditionalSlot: auto_transition_phase_id を読み戻す（再編集で保持）", () => {
    const slot = msgToAdditionalSlot({ message_type: "text", body: "案内", auto_transition_phase_id: "phase-6mon" });
    expect(slot.auto_transition_phase_id).toBe("phase-6mon");
  });

  it("msgToAdditionalSlot: null は空文字（移動しない）で復元", () => {
    const slot = msgToAdditionalSlot({ message_type: "text", body: "案内", auto_transition_phase_id: null });
    expect(slot.auto_transition_phase_id).toBe("");
  });

  it("additionalSlotToMsgBody: 設定値を body に含める（message_type 非依存）", () => {
    const body = additionalSlotToMsgBody({ ...EMPTY_ADDITIONAL_SLOT, message_type: "text", body: "案内", auto_transition_phase_id: "phase-6mon" }, main);
    expect(body.auto_transition_phase_id).toBe("phase-6mon");
  });

  it("additionalSlotToMsgBody: 空文字（移動しない）は null で送る", () => {
    const body = additionalSlotToMsgBody({ ...EMPTY_ADDITIONAL_SLOT, message_type: "text", body: "案内", auto_transition_phase_id: "" }, main);
    expect(body.auto_transition_phase_id).toBe(null);
  });

  it("round-trip: msg → slot → body で値が保持される", () => {
    const slot = msgToAdditionalSlot({ message_type: "image", asset_url: "https://x/a.png", auto_transition_phase_id: "phase-6mon" });
    const body = additionalSlotToMsgBody(slot, main);
    expect(body.auto_transition_phase_id).toBe("phase-6mon");
  });
});

describe("msgToAdditionalSlot — image_action 読込 + 旧 tap_* 後方互換", () => {
  it("image_action(uri) を持つ slot はそのまま復元", () => {
    const slot = msgToAdditionalSlot({ message_type: "image", image_action_type: "uri", image_action_url: "https://ex.com/" });
    expect(slot.image_action_type).toBe("uri");
    expect(slot.image_action_url).toBe("https://ex.com/");
  });

  it("image_action(message) を持つ slot はそのまま復元", () => {
    const slot = msgToAdditionalSlot({ message_type: "image", image_action_type: "message", image_action_text: "古い写真を見る" });
    expect(slot.image_action_type).toBe("message");
    expect(slot.image_action_text).toBe("古い写真を見る");
  });

  it("旧 tap_url（直接URL）あり・image_action なし → URLを開く(uri) に移行", () => {
    const slot = msgToAdditionalSlot({ message_type: "image", tap_url: "https://legacy.example.com/x" });
    expect(slot.image_action_type).toBe("uri");
    expect(slot.image_action_url).toBe("https://legacy.example.com/x");
  });

  it("旧 tap_destination_id（保存済み遷移先）あり → resolver で解決し uri に移行", () => {
    const slot = msgToAdditionalSlot(
      { message_type: "image", tap_destination_id: "dest-1" },
      (id) => (id === "dest-1" ? "https://resolved.example.com/" : null),
    );
    expect(slot.image_action_type).toBe("uri");
    expect(slot.image_action_url).toBe("https://resolved.example.com/");
  });

  it("アクションなし画像 → image_action_type は空（なし）", () => {
    const slot = msgToAdditionalSlot({ message_type: "image" });
    expect(slot.image_action_type).toBe("");
    expect(slot.image_action_url).toBe("");
  });

  it("image_action は tap_url より優先（二重設定でも image_action を採用）", () => {
    const slot = msgToAdditionalSlot({ message_type: "image", image_action_type: "uri", image_action_url: "https://new/", tap_url: "https://old/" });
    expect(slot.image_action_url).toBe("https://new/");
  });
});

describe("additionalSlotToMsgBody — image_action 保存（image のみ・uri→url / message→text）", () => {
  it("image + uri → image_action_type='uri'・url を保存・text は null", () => {
    const body = additionalSlotToMsgBody(imageSlot({ image_action_type: "uri", image_action_url: "https://ex.com/" }), main);
    expect(body.image_action_type).toBe("uri");
    expect(body.image_action_url).toBe("https://ex.com/");
    expect(body.image_action_text).toBeNull();
  });

  it("image + message → image_action_type='message'・text を保存・url は null", () => {
    const body = additionalSlotToMsgBody(imageSlot({ image_action_type: "message", image_action_text: "見る" }), main);
    expect(body.image_action_type).toBe("message");
    expect(body.image_action_text).toBe("見る");
    expect(body.image_action_url).toBeNull();
  });

  it("image + なし(空) → image_action は全て null（不要な旧値を送信payloadに残さない）", () => {
    const body = additionalSlotToMsgBody(imageSlot({ image_action_type: "", image_action_url: "x", image_action_text: "y" }), main);
    expect(body.image_action_type).toBeNull();
    expect(body.image_action_url).toBeNull();
    expect(body.image_action_text).toBeNull();
  });

  it("非画像メッセージ（text）は image_action を保存しない（null）", () => {
    const body = additionalSlotToMsgBody({ ...EMPTY_ADDITIONAL_SLOT, message_type: "text", body: "hi", image_action_type: "uri", image_action_url: "https://x/" }, main);
    expect(body.image_action_type).toBeNull();
    expect(body.image_action_url).toBeNull();
  });

  it("uri で url 空文字 → null（空は保存しない）", () => {
    const body = additionalSlotToMsgBody(imageSlot({ image_action_type: "uri", image_action_url: "   " }), main);
    expect(body.image_action_url).toBeNull();
  });

  it("EMPTY_ADDITIONAL_SLOT は image_action を持つ（型の後方互換）", () => {
    expect(EMPTY_ADDITIONAL_SLOT.image_action_type).toBe("");
    expect(EMPTY_ADDITIONAL_SLOT.image_action_text).toBe("");
    expect(EMPTY_ADDITIONAL_SLOT.image_action_url).toBe("");
    expect(EMPTY_ADDITIONAL_SLOT.image_action_phase_id).toBe("");
  });
});

describe("message_with_phase（メッセージ送信＋フェーズ遷移）の slot load/save", () => {
  it("load: message_with_phase の type/text/phase_id を復元", () => {
    const slot = msgToAdditionalSlot({ message_type: "image", image_action_type: "message_with_phase", image_action_text: "次へ", image_action_phase_id: "phase-2" });
    expect(slot.image_action_type).toBe("message_with_phase");
    expect(slot.image_action_text).toBe("次へ");
    expect(slot.image_action_phase_id).toBe("phase-2");
  });

  it("save: image + message_with_phase → type/text/phase_id を保存（url は null）", () => {
    const body = additionalSlotToMsgBody(imageSlot({ image_action_type: "message_with_phase", image_action_text: "次へ", image_action_phase_id: "phase-2" }), main);
    expect(body.image_action_type).toBe("message_with_phase");
    expect(body.image_action_text).toBe("次へ");
    expect(body.image_action_phase_id).toBe("phase-2");
    expect(body.image_action_url).toBeNull();
  });

  it("save: message_with_phase 以外は phase_id を保存しない（null）", () => {
    const body = additionalSlotToMsgBody(imageSlot({ image_action_type: "uri", image_action_url: "https://x/", image_action_phase_id: "phase-2" }), main);
    expect(body.image_action_phase_id).toBeNull();
  });

  it("save: message に変更した場合は残った phase_id を null 化（orphan cleanup）", () => {
    const body = additionalSlotToMsgBody(imageSlot({ image_action_type: "message", image_action_text: "調べる", image_action_phase_id: "phase-2" }), main);
    expect(body.image_action_type).toBe("message");
    expect(body.image_action_text).toBe("調べる");
    expect(body.image_action_phase_id).toBeNull();
  });

  it("save: none（type 未設定）でも残った phase_id を null 化（orphan cleanup）", () => {
    const body = additionalSlotToMsgBody(imageSlot({ image_action_type: "", image_action_phase_id: "phase-2" }), main);
    expect(body.image_action_type).toBeNull();
    expect(body.image_action_phase_id).toBeNull();
  });

  it("save: 非画像メッセージは message_with_phase を保存しない（全て null）", () => {
    const body = additionalSlotToMsgBody({ ...EMPTY_ADDITIONAL_SLOT, message_type: "text", body: "hi", image_action_type: "message_with_phase", image_action_text: "x", image_action_phase_id: "p" }, main);
    expect(body.image_action_type).toBeNull();
    expect(body.image_action_phase_id).toBeNull();
  });

  it("既存 message は message_with_phase に勝手に変換されない", () => {
    const slot = msgToAdditionalSlot({ message_type: "image", image_action_type: "message", image_action_text: "見る" });
    expect(slot.image_action_type).toBe("message");
    expect(slot.image_action_phase_id).toBe("");
  });

  it("既存 uri / 旧 tap_url は message_with_phase に変換されない（PR #434 互換維持）", () => {
    expect(msgToAdditionalSlot({ message_type: "image", image_action_type: "uri", image_action_url: "https://x/" }).image_action_type).toBe("uri");
    expect(msgToAdditionalSlot({ message_type: "image", tap_url: "https://legacy/" }).image_action_type).toBe("uri");
  });
});
