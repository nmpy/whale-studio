// src/__tests__/per-message-timing.test.ts
//
// 2 通目以降のメッセージにも演出設定 (lag_ms / read_* / typing_* / loading_*) が
// 個別保存できることを担保する unit テスト。
//
// - msgToAdditionalSlot: API response → AdditionalMessageSlot ラウンドトリップ
// - additionalSlotToMsgBody: slot → /api/messages 用 body (= prisma column)
//
// DB / API / React は触らず純関数のみテストする。

import { describe, it, expect } from "vitest";
import {
  msgToAdditionalSlot,
  additionalSlotToMsgBody,
  type AdditionalMessageSlot,
} from "@/app/oas/[id]/works/[workId]/messages/_form-helpers";

describe("msgToAdditionalSlot — Message API response から AdditionalMessageSlot 復元", () => {
  it("全フィールドが入っているレコードを正しく復元する", () => {
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
    expect(slot.loading_enabled).toBe("false");
  });

  it("既存形式 (timing 系がすべて null) でもエラーにならず inherit (空文字) になる", () => {
    const slot = msgToAdditionalSlot({
      id: "m-legacy",
      message_type: "text",
      body: "既存メッセージ",
    });
    expect(slot.lag_ms).toBe(0);
    expect(slot.read_receipt_mode).toBe("");
    expect(slot.read_delay_ms).toBe("");
    expect(slot.typing_enabled).toBe("");
    expect(slot.loading_enabled).toBe("");
  });

  it("typing_enabled=false が文字列 \"false\" として保持される", () => {
    const slot = msgToAdditionalSlot({
      id: "m",
      message_type: "text",
      typing_enabled: false,
    });
    expect(slot.typing_enabled).toBe("false");
  });
});

describe("additionalSlotToMsgBody — slot → API body (= prisma column 値)", () => {
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
      lag_ms:         0,
      read_receipt_mode:    "",
      read_delay_ms:        "",
      typing_enabled:       "",
      typing_min_ms:        "",
      typing_max_ms:        "",
      loading_enabled:      "",
      loading_threshold_ms: "",
      loading_min_seconds:  "",
      loading_max_seconds:  "",
    };
  }

  it("演出未設定スロットは全 timing が null (= inherit)", () => {
    const body = additionalSlotToMsgBody(baseSlot(), MAIN);
    expect(body.lag_ms).toBe(0);
    expect(body.read_receipt_mode).toBeNull();
    expect(body.read_delay_ms).toBeNull();
    expect(body.typing_enabled).toBeNull();
    expect(body.typing_min_ms).toBeNull();
    expect(body.typing_max_ms).toBeNull();
    expect(body.loading_enabled).toBeNull();
    expect(body.loading_threshold_ms).toBeNull();
    expect(body.loading_min_seconds).toBeNull();
    expect(body.loading_max_seconds).toBeNull();
  });

  it("typing_enabled=\"true\" + 数値で正しく boolean / number 化される", () => {
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

  it("read_receipt_mode=\"delayed\" + read_delay_ms が正しく転送される", () => {
    const slot: AdditionalMessageSlot = {
      ...baseSlot(),
      read_receipt_mode: "delayed",
      read_delay_ms: "1500",
    };
    const body = additionalSlotToMsgBody(slot, MAIN);
    expect(body.read_receipt_mode).toBe("delayed");
    expect(body.read_delay_ms).toBe(1500);
  });

  it("loading_enabled=\"false\" は false に変換される (inherit と区別)", () => {
    const slot: AdditionalMessageSlot = {
      ...baseSlot(),
      loading_enabled: "false",
    };
    const body = additionalSlotToMsgBody(slot, MAIN);
    expect(body.loading_enabled).toBe(false);  // null ではない (明示的に OFF)
  });

  it("character_id 空文字なら main の character_id を引き継ぐ", () => {
    const body = additionalSlotToMsgBody(baseSlot(), MAIN);
    expect(body.character_id).toBe(MAIN.character_id);
  });

  it("character_id 指定があればスロット個別の値を使う", () => {
    const body = additionalSlotToMsgBody({ ...baseSlot(), character_id: "c-special" }, MAIN);
    expect(body.character_id).toBe("c-special");
  });

  it("phase_id / kind / sort_order / is_active は main を引き継ぐ", () => {
    const body = additionalSlotToMsgBody(baseSlot(), MAIN);
    expect(body.phase_id).toBe(MAIN.phase_id);
    expect(body.kind).toBe(MAIN.kind);
    expect(body.sort_order).toBe(MAIN.sort_order);
    expect(body.is_active).toBe(MAIN.is_active);
  });
});

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
    expect(body.loading_enabled).toBe(false);
  });
});
