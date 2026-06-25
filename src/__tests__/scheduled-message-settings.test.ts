/**
 * src/__tests__/scheduled-message-settings.test.ts
 * 時間差メッセージ（予約送信）の CMS 設定保存（PR-4c-1）。
 * Zod バリデーション（enabled で delay/body 必須・delay 範囲）とフォーム変換（保存→再編集の復元）を検証。
 * 実 push・予約レコード作成・webhook 接続は無い（このPRは設定保存のみ）。
 */
import { describe, it, expect } from "vitest";
import { scheduledMessageSettingsSchema } from "@/lib/validations";
import {
  formStateToScheduledSettings, scheduledSettingsToFormState,
  EMPTY_SCHEDULED_MESSAGE, type ScheduledMessageFormState,
} from "@/app/oas/[id]/works/[workId]/messages/_form-helpers";

const UUID = "0123abcd-4567-89ef-0123-456789abcdef";

describe("scheduledMessageSettingsSchema — バリデーション", () => {
  it("enabled=false なら delay/body 無しでも OK", () => {
    expect(scheduledMessageSettingsSchema.safeParse({ enabled: false }).success).toBe(true);
  });

  it("enabled=true は delay_minutes と body が必須", () => {
    expect(scheduledMessageSettingsSchema.safeParse({ enabled: true }).success).toBe(false);
    expect(scheduledMessageSettingsSchema.safeParse({ enabled: true, delay_minutes: 10 }).success).toBe(false); // body 無し
    expect(scheduledMessageSettingsSchema.safeParse({ enabled: true, body: "やあ" }).success).toBe(false);      // delay 無し
    expect(scheduledMessageSettingsSchema.safeParse({ enabled: true, delay_minutes: 10, body: "  " }).success).toBe(false); // 空白 body
    expect(scheduledMessageSettingsSchema.safeParse({ enabled: true, delay_minutes: 10, body: "やあ" }).success).toBe(true);
  });

  it("delay 10 / 30 / 60 / 1440 / 10080 は OK", () => {
    for (const m of [10, 30, 60, 1440, 10080]) {
      expect(scheduledMessageSettingsSchema.safeParse({ enabled: true, delay_minutes: m, body: "x" }).success).toBe(true);
    }
  });

  it("delay 0 / 負 / 小数 / 上限超過 は拒否", () => {
    for (const m of [0, -5, 10081, 1.5]) {
      expect(scheduledMessageSettingsSchema.safeParse({ enabled: true, delay_minutes: m, body: "x" }).success).toBe(false);
    }
  });

  it("character_id は uuid のみ（不正は拒否・null/未指定は OK）", () => {
    expect(scheduledMessageSettingsSchema.safeParse({ enabled: false, character_id: "not-a-uuid" }).success).toBe(false);
    expect(scheduledMessageSettingsSchema.safeParse({ enabled: false, character_id: UUID }).success).toBe(true);
    expect(scheduledMessageSettingsSchema.safeParse({ enabled: false, character_id: null }).success).toBe(true);
  });

  it("cancel フラグは省略時 false", () => {
    const p = scheduledMessageSettingsSchema.parse({ enabled: false });
    expect(p.cancel_on_phase_change).toBe(false);
    expect(p.cancel_on_work_completed).toBe(false);
  });
});

describe("フォーム変換 — 保存→再編集の復元", () => {
  it("未操作（既定）は null で送る（DB を汚さない）", () => {
    expect(formStateToScheduledSettings({ ...EMPTY_SCHEDULED_MESSAGE })).toBeNull();
  });

  it("enabled + 値ありは object で送る（body trim / character '' → null）", () => {
    const s: ScheduledMessageFormState = {
      enabled: true, delay_minutes: 30, body: "本文", character_id: "", cancel_on_phase_change: true, cancel_on_work_completed: false, hold_chain_until_sent: false,
    };
    expect(formStateToScheduledSettings(s)).toEqual({
      enabled: true, delay_minutes: 30, body: "本文", character_id: null, cancel_on_phase_change: true, cancel_on_work_completed: false, hold_chain_until_sent: false,
    });
  });

  it("無効でも値があれば保持して送る（保存済み値を消さない）", () => {
    const s: ScheduledMessageFormState = { ...EMPTY_SCHEDULED_MESSAGE, enabled: false, body: "保持したい" };
    expect(formStateToScheduledSettings(s)?.body).toBe("保持したい");
  });

  it("API レスポンス object → フォーム状態へ復元（round-trip）", () => {
    const saved = formStateToScheduledSettings({
      enabled: true, delay_minutes: 60, body: "あとで", character_id: UUID, cancel_on_phase_change: false, cancel_on_work_completed: true, hold_chain_until_sent: true,
    });
    const restored = scheduledSettingsToFormState(saved);
    expect(restored).toEqual({
      enabled: true, delay_minutes: 60, body: "あとで", character_id: UUID, cancel_on_phase_change: false, cancel_on_work_completed: true, hold_chain_until_sent: true,
    });
  });

  it("null / 不正な保存値 → 既定にフォールバック", () => {
    expect(scheduledSettingsToFormState(null)).toEqual(EMPTY_SCHEDULED_MESSAGE);
    expect(scheduledSettingsToFormState("garbage")).toEqual(EMPTY_SCHEDULED_MESSAGE);
    expect(scheduledSettingsToFormState({ enabled: true, delay_minutes: 0 }).delay_minutes).toBe(EMPTY_SCHEDULED_MESSAGE.delay_minutes); // 不正 delay は既定へ
  });
});
