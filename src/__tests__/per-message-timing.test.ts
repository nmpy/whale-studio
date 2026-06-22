// src/__tests__/per-message-timing.test.ts
//
// 2 通目以降のメッセージにも演出設定 (lag_ms / read_* / typing_* / loading_*) が
// 個別保存・復元できることを担保する unit テスト。Phase 2b スコープ。
//
// 検証対象 (= 純関数):
//   - msgToAdditionalSlot:     API response → AdditionalMessageSlot (= load 時の正規化)
//   - additionalSlotToMsgBody: AdditionalMessageSlot → /api/messages body (= save 時)
//
// DB / React は触らず、純関数のみで挙動を担保する。

import { describe, it, expect } from "vitest";
import {
  msgToAdditionalSlot,
  additionalSlotToMsgBody,
  type AdditionalMessageSlot,
} from "@/app/oas/[id]/works/[workId]/messages/_form-helpers";

// ──────────────────────────────────────────────────────────
// msgToAdditionalSlot — Message API response から slot 復元
// ──────────────────────────────────────────────────────────

describe("msgToAdditionalSlot — Message API response から AdditionalMessageSlot 復元", () => {
  it("全フィールド入りのレコードを正しく復元する", () => {
    const slot = msgToAdditionalSlot({
      id: "m-2",
      character_id: "c-1",
      message_type: "text",
      body: "ここから先は慎重に進んでください",
      asset_url: null,
      notify_text: null,
      lag_ms: 2000,
      read_receipt_mode: "delayed",
      read_delay_ms: 1000,
      typing_enabled: true,
      typing_min_ms: 1500,
      typing_max_ms: 2500,
      loading_enabled: false,
      loading_threshold_ms: null,
      loading_min_seconds: null,
      loading_max_seconds: null,
    });
    expect(slot.existingId).toBe("m-2");
    expect(slot.lag_ms).toBe(2000);
    expect(slot.read_receipt_mode).toBe("delayed");
    expect(slot.read_delay_ms).toBe("1000");
    expect(slot.typing_enabled).toBe("true");
    expect(slot.typing_min_ms).toBe("1500");
    expect(slot.typing_max_ms).toBe("2500");
    expect(slot.loading_enabled).toBe("false");  // 明示 false は保持される
  });

  it("legacy データ (timing 全 null) は OFF 相当に正規化される (= 継承モード廃止)", () => {
    const slot = msgToAdditionalSlot({
      id: "m-legacy",
      message_type: "text",
      body: "既存メッセージ",
    });
    expect(slot.lag_ms).toBe(0);
    // read_receipt_mode: null → "immediate" (= OFF, 人為的な既読遅延なし)
    expect(slot.read_receipt_mode).toBe("immediate");
    // 数値フィールドは null → 空文字 (= 未指定、runtime 固定デフォルト適用)
    expect(slot.read_delay_ms).toBe("");
    // typing_enabled / loading_enabled: null → "false" (= OFF)
    expect(slot.typing_enabled).toBe("false");
    expect(slot.loading_enabled).toBe("false");
  });

  it("typing_enabled=false が文字列 \"false\" として保持される (= true/false 区別)", () => {
    const slot = msgToAdditionalSlot({
      id: "m",
      message_type: "text",
      typing_enabled: false,
    });
    expect(slot.typing_enabled).toBe("false");
  });

  it("loading_enabled=true / false の両方が正しく文字列化される", () => {
    const s1 = msgToAdditionalSlot({ id: "m1", message_type: "text", loading_enabled: true });
    const s2 = msgToAdditionalSlot({ id: "m2", message_type: "text", loading_enabled: false });
    expect(s1.loading_enabled).toBe("true");
    expect(s2.loading_enabled).toBe("false");
  });

  it("0 ms の lag_ms / 数値は文字列化されるが意味は維持", () => {
    const slot = msgToAdditionalSlot({
      id: "m",
      message_type: "text",
      lag_ms: 0,
      read_delay_ms: 0,
    });
    expect(slot.lag_ms).toBe(0);
    expect(slot.read_delay_ms).toBe("0");  // 数値 0 → 文字列 "0" (= 空文字 inherit と区別)
  });

  it("character_id null → 空文字 (= 1 通目を引き継ぐシグナル)", () => {
    const slot = msgToAdditionalSlot({ id: "m", character_id: null, message_type: "text" });
    expect(slot.character_id).toBe("");
  });

  it("carousel 型は body を JSON parse して carousel_items に詰める", () => {
    const items = [{ image_url: "https://x", title: "t", body: "b", button_label: "btn", button_url: "" }];
    const slot = msgToAdditionalSlot({
      id: "m",
      message_type: "carousel",
      body: JSON.stringify(items),
    });
    expect(slot.body).toBe("");  // carousel は body 文字列としては空
    expect(slot.carousel_items).toHaveLength(1);
    expect(slot.carousel_items[0].title).toBe("t");
  });

  it("carousel 型で body が壊れた JSON でもクラッシュしない", () => {
    const slot = msgToAdditionalSlot({
      id: "m",
      message_type: "carousel",
      body: "{not valid json",
    });
    expect(slot.carousel_items).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────
// additionalSlotToMsgBody — slot → API body (= prisma column)
// ──────────────────────────────────────────────────────────

describe("additionalSlotToMsgBody — slot → API body", () => {
  const MAIN = {
    work_id:      "11111111-1111-1111-1111-111111111111",
    phase_id:     "22222222-2222-2222-2222-222222222222",
    character_id: "33333333-3333-3333-3333-333333333333",
    kind:         "normal" as const,
    sort_order:   0,
    is_active:    true,
  };

  function baseSlot(): AdditionalMessageSlot {
    return {
      character_id:   "",
      message_type:   "text",
      body:           "hi",
      asset_url:      "",
      notify_text:    "",
      carousel_items: [],
      carousel_card_type: "product" as const,
      carousel_cards: [],
      alt_text:           "",
      flex_payload_json:  "",
      lag_ms:         0,
      // 継承モード廃止: slot は常に明示 OFF 値を持つ。
      read_receipt_mode:    "immediate",
      read_delay_ms:        "",
      typing_enabled:       "false",
      typing_min_ms:        "",
      typing_max_ms:        "",
      loading_enabled:      "false",
      loading_threshold_ms: "",
      loading_min_seconds:  "",
      loading_max_seconds:  "",
      image_action_type: "",
      image_action_text: "",
      image_action_url:  "",
      image_action_phase_id: "",
      free_input_enabled:         false,
      free_input_variable_key:    "",
      free_input_next_message_id: "",
    };
  }

  it("演出 OFF スロットは enable 系が false、数値系が null で送信される (= 継承モード廃止)", () => {
    const body = additionalSlotToMsgBody(baseSlot(), MAIN);
    expect(body.lag_ms).toBe(0);
    // read_receipt_mode は "immediate" (= OFF) を明示送信
    expect(body.read_receipt_mode).toBe("immediate");
    // 数値フィールドは未指定なら null (= runtime 固定デフォルトを使用)
    expect(body.read_delay_ms).toBeNull();
    // enable flag は明示 false で送信 (= 旧 null inherit ではなく)
    expect(body.typing_enabled).toBe(false);
    expect(body.typing_min_ms).toBeNull();
    expect(body.typing_max_ms).toBeNull();
    expect(body.loading_enabled).toBe(false);
    expect(body.loading_threshold_ms).toBeNull();
    expect(body.loading_min_seconds).toBeNull();
    expect(body.loading_max_seconds).toBeNull();
  });

  it('typing_enabled="true" + 数値で正しく boolean / number 化される', () => {
    const slot: AdditionalMessageSlot = {
      ...baseSlot(),
      lag_ms: 2000,
      typing_enabled: "true",
      typing_min_ms: "1500",
      typing_max_ms: "2500",
    };
    const body = additionalSlotToMsgBody(slot, MAIN);
    expect(body.lag_ms).toBe(2000);
    expect(body.typing_enabled).toBe(true);
    expect(body.typing_min_ms).toBe(1500);
    expect(body.typing_max_ms).toBe(2500);
  });

  it('read_receipt_mode="delayed" + read_delay_ms が正しく転送される', () => {
    const slot: AdditionalMessageSlot = {
      ...baseSlot(),
      read_receipt_mode: "delayed",
      read_delay_ms: "1500",
    };
    const body = additionalSlotToMsgBody(slot, MAIN);
    expect(body.read_receipt_mode).toBe("delayed");
    expect(body.read_delay_ms).toBe(1500);
  });

  it('loading_enabled="false" は false に変換される (= null inherit と区別される)', () => {
    const slot: AdditionalMessageSlot = {
      ...baseSlot(),
      loading_enabled: "false",
    };
    const body = additionalSlotToMsgBody(slot, MAIN);
    expect(body.loading_enabled).toBe(false);
    expect(body.loading_enabled).not.toBeNull();
  });

  it("character_id 空文字なら main.character_id を引き継ぐ", () => {
    const body = additionalSlotToMsgBody(baseSlot(), MAIN);
    expect(body.character_id).toBe(MAIN.character_id);
  });

  it("character_id 指定があれば slot 個別の値を使う", () => {
    const body = additionalSlotToMsgBody({ ...baseSlot(), character_id: "c-special" }, MAIN);
    expect(body.character_id).toBe("c-special");
  });

  it("phase_id / kind / sort_order / is_active は main から引き継ぐ", () => {
    const body = additionalSlotToMsgBody(baseSlot(), MAIN);
    expect(body.phase_id).toBe(MAIN.phase_id);
    expect(body.kind).toBe(MAIN.kind);
    expect(body.sort_order).toBe(MAIN.sort_order);
    expect(body.is_active).toBe(MAIN.is_active);
  });

  it("message_type=image 時に asset_url が body の代わりに転送される", () => {
    const slot: AdditionalMessageSlot = {
      ...baseSlot(),
      message_type: "image",
      asset_url: "https://example.com/img.png",
      body: "(unused for image)",
    };
    const body = additionalSlotToMsgBody(slot, MAIN);
    expect(body.asset_url).toBe("https://example.com/img.png");
    expect(body.body).toBeUndefined();
  });

  it("message_type=carousel 時に carousel_items が JSON 化されて body に入る", () => {
    const slot: AdditionalMessageSlot = {
      ...baseSlot(),
      message_type: "carousel",
      carousel_card_type: "product",
      carousel_cards: [{ title: "t", action: { type: "url", label: "見る", url: "https://e.com" } }],
    };
    const body = additionalSlotToMsgBody(slot, MAIN);
    // 連続メッセージ carousel は新形式 {type,cardType,cards} で保存される。
    expect(body.body).toBe(JSON.stringify({ type: "carousel", cardType: "product", cards: slot.carousel_cards }));
  });

  it("message_type=text の本文が空なら body=undefined (= API バリデーション側で 弾く想定)", () => {
    const body = additionalSlotToMsgBody({ ...baseSlot(), body: "" }, MAIN);
    expect(body.body).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────
// ラウンドトリップ
// ──────────────────────────────────────────────────────────

describe("ラウンドトリップ — API response → slot → API body", () => {
  it("演出設定がラウンドトリップで保持される", () => {
    const apiMsg = {
      id: "m-2",
      character_id: "c-1",
      message_type: "text",
      body: "ようこそ",
      lag_ms: 2000,
      read_receipt_mode: "delayed",
      read_delay_ms: 1000,
      typing_enabled: true,
      typing_min_ms: 1200,
      typing_max_ms: 1800,
      loading_enabled: false,
      loading_threshold_ms: null,
      loading_min_seconds: null,
      loading_max_seconds: null,
    };
    const slot = msgToAdditionalSlot(apiMsg);
    const body = additionalSlotToMsgBody(slot, {
      work_id: "w", phase_id: null, character_id: null,
      kind: "normal", sort_order: 0, is_active: true,
    });
    expect(body.lag_ms).toBe(2000);
    expect(body.read_receipt_mode).toBe("delayed");
    expect(body.read_delay_ms).toBe(1000);
    expect(body.typing_enabled).toBe(true);
    expect(body.typing_min_ms).toBe(1200);
    expect(body.typing_max_ms).toBe(1800);
    expect(body.loading_enabled).toBe(false);  // 明示 false が保持
  });

  it("legacy null データのラウンドトリップは OFF 相当に正規化される (= 継承モード廃止)", () => {
    const apiMsg = { id: "m", message_type: "text", body: "legacy" };
    const slot = msgToAdditionalSlot(apiMsg);
    const body = additionalSlotToMsgBody(slot, {
      work_id: "w", phase_id: null, character_id: null,
      kind: "normal", sort_order: 0, is_active: true,
    });
    // 旧 null inherit → 明示 OFF (= immediate / false) で再保存される
    expect(body.read_receipt_mode).toBe("immediate");
    expect(body.typing_enabled).toBe(false);
    expect(body.loading_enabled).toBe(false);
  });
});
