/**
 * src/__tests__/scheduled-message-slot.test.ts
 *
 * PR-STG-A: 2通目以降（additional slot）にも「時間差メッセージ（予約送信）」を保存/復元できること。
 * lag_ms は短時間演出として残し新規は最大8秒（UI cap）だが、既存の超過値は save で破壊しない（読み取り専用）。
 * runtime/arm/worker/cron/schema は不変（arm は既に任意 messageId の scheduledMessageSettings を拾う）。
 */
import { describe, it, expect } from "vitest";
import {
  EMPTY_ADDITIONAL_SLOT, SLOT_LAG_MS_MAX,
  additionalSlotToMsgBody, msgToAdditionalSlot,
  type AdditionalMessageSlot,
} from "@/app/oas/[id]/works/[workId]/messages/_form-helpers";
import { messageToResponse } from "@/lib/api/list-shapes";

const MAIN = { work_id: "w1", phase_id: "p1", character_id: null, kind: "normal" as const, sort_order: 1, is_active: true };
const slot = (o: Partial<AdditionalMessageSlot> = {}): AdditionalMessageSlot => ({ ...EMPTY_ADDITIONAL_SLOT, ...o });

describe("slot 予約送信 save (additionalSlotToMsgBody)", () => {
  it("enabled な予約送信は scheduled_message_settings に反映される", () => {
    const body = additionalSlotToMsgBody(
      slot({ scheduled_message: { enabled: true, delay_minutes: 10, body: "10分後テスト", character_id: "", cancel_on_phase_change: true, cancel_on_work_completed: true } }),
      MAIN,
    );
    expect(body.scheduled_message_settings).toEqual({
      enabled: true, delay_minutes: 10, body: "10分後テスト", character_id: null,
      cancel_on_phase_change: true, cancel_on_work_completed: true,
    });
  });
  it("未操作の予約送信は null（DB を汚さない）", () => {
    expect(additionalSlotToMsgBody(slot(), MAIN).scheduled_message_settings).toBeNull();
  });
});

describe("slot 予約送信 restore (msgToAdditionalSlot)", () => {
  it("scheduled_message_settings から復元される", () => {
    const s = msgToAdditionalSlot({
      id: "m2", body: "本文",
      scheduled_message_settings: { enabled: true, delay_minutes: 30, body: "後で", character_id: "c1", cancel_on_phase_change: false, cancel_on_work_completed: true },
    });
    expect(s.scheduled_message).toEqual({
      enabled: true, delay_minutes: 30, body: "後で", character_id: "c1",
      cancel_on_phase_change: false, cancel_on_work_completed: true,
    });
  });
  it("設定なし → enabled:false の空状態", () => {
    expect(msgToAdditionalSlot({ id: "m2", body: "x" }).scheduled_message.enabled).toBe(false);
  });
  it("save → restore 往復で保持される", () => {
    const original = slot({ scheduled_message: { enabled: true, delay_minutes: 60, body: "1時間後", character_id: "", cancel_on_phase_change: true, cancel_on_work_completed: false } });
    const body = additionalSlotToMsgBody(original, MAIN);
    const restored = msgToAdditionalSlot({ id: "m2", scheduled_message_settings: body.scheduled_message_settings });
    expect(restored.scheduled_message).toMatchObject({ enabled: true, delay_minutes: 60, body: "1時間後", cancel_on_phase_change: true });
  });
});

describe("lag_ms は非破壊（save で clamp しない）＋ cap 定数", () => {
  it("SLOT_LAG_MS_MAX は 8000ms（8秒）", () => {
    expect(SLOT_LAG_MS_MAX).toBe(8000);
  });
  it("既存の超過 lag_ms（>8秒）は save でそのまま保持される（自動クリアしない）", () => {
    // UI 側で新規入力は 8秒に cap するが、既存データの保存経路は値を変えない（破壊的変更回避）。
    expect(additionalSlotToMsgBody(slot({ lag_ms: 600000 }), MAIN).lag_ms).toBe(600000);
  });
  it("8秒以下はそのまま保存", () => {
    expect(additionalSlotToMsgBody(slot({ lag_ms: 3000 }), MAIN).lag_ms).toBe(3000);
  });
});

describe("list-shape は continuation 復元用に scheduled_message_settings を露出する", () => {
  const base = {
    id: "m", workId: "w", phaseId: "p", characterId: null, messageType: "text", kind: "normal",
    body: "b", assetUrl: null, triggerKeyword: null, targetSegment: null, notifyText: null,
    riddleId: null, quickReplies: null,
  };
  // messageToResponse の引数型は多数フィールドを要求するため、テスト fixture は最小 + cast で渡す。
  const resp = (extra: Record<string, unknown> = {}) =>
    messageToResponse({ ...base, ...extra } as Parameters<typeof messageToResponse>[0]) as { scheduled_message_settings: unknown };
  it("scheduledMessageSettings(JSON) → parse 済み object", () => {
    expect(resp({ scheduledMessageSettings: JSON.stringify({ enabled: true, delay_minutes: 10, body: "x" }) }).scheduled_message_settings)
      .toEqual({ enabled: true, delay_minutes: 10, body: "x" });
  });
  it("未設定 → null", () => {
    expect(resp().scheduled_message_settings).toBeNull();
  });
  it("壊れた JSON → null（throw しない）", () => {
    expect(resp({ scheduledMessageSettings: "{壊れ" }).scheduled_message_settings).toBeNull();
  });
});
