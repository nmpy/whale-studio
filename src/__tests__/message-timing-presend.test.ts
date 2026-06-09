// src/__tests__/message-timing-presend.test.ts
//
// 送信前待機（head lag_ms）の解決と、メッセージ単位 timing の OFF/未設定/個別 区別を検証する。

import { describe, it, expect } from "vitest";
import { resolveHeadSendDelayMs } from "@/lib/line";
import { resolveMessageTimingConfig } from "@/lib/line-read-receipt";
import type { MessageTimingConfig } from "@/types";

describe("resolveHeadSendDelayMs（送信前待機 / head lag_ms）", () => {
  it("個別設定 5000ms → 5000（そのまま）", () => {
    expect(resolveHeadSendDelayMs({ _lagMs: 5000 })).toBe(5000);
  });
  it("3000ms → 3000", () => {
    expect(resolveHeadSendDelayMs({ _lagMs: 3000 })).toBe(3000);
  });
  it("0 / undefined / null = OFF → 0", () => {
    expect(resolveHeadSendDelayMs({ _lagMs: 0 })).toBe(0);
    expect(resolveHeadSendDelayMs({})).toBe(0);
    expect(resolveHeadSendDelayMs(undefined)).toBe(0);
    expect(resolveHeadSendDelayMs(null)).toBe(0);
  });
  it("上限を超える値は MAX_MSG_LAG_MS(600000) にクランプ", () => {
    expect(resolveHeadSendDelayMs({ _lagMs: 999999999 })).toBe(600000);
  });
  it("負値は 0 扱い", () => {
    expect(resolveHeadSendDelayMs({ _lagMs: -100 })).toBe(0);
  });
});

describe("resolveMessageTimingConfig（typing: OFF / 未設定 / 個別）", () => {
  const base: MessageTimingConfig = {
    read_receipt_mode: null, read_delay_ms: null,
    typing_enabled: null, typing_min_ms: null, typing_max_ms: null,
    loading_enabled: null, loading_threshold_ms: null, loading_min_seconds: null, loading_max_seconds: null,
  };

  it("個別設定: typing ON + 5000ms → typingEnabled true / min・max 5000", () => {
    const r = resolveMessageTimingConfig({ ...base, typing_enabled: true, typing_min_ms: 5000, typing_max_ms: 5000 });
    expect(r.typingEnabled).toBe(true);
    expect(r.typingMinMs).toBe(5000);
    expect(r.typingMaxMs).toBe(5000);
  });

  it("OFF: typing_enabled=false → typingEnabled false", () => {
    expect(resolveMessageTimingConfig({ ...base, typing_enabled: false }).typingEnabled).toBe(false);
  });

  it("未設定（null）→ typingEnabled false（明示 OFF と同じ扱い・env enable には fallback しない仕様）", () => {
    expect(resolveMessageTimingConfig(base).typingEnabled).toBe(false);
    expect(resolveMessageTimingConfig(null).typingEnabled).toBe(false);
  });

  it("typing 数値が未設定でも enable=true なら固定デフォルトで埋まる（NaN/undefined にならない）", () => {
    const r = resolveMessageTimingConfig({ ...base, typing_enabled: true });
    expect(typeof r.typingMinMs).toBe("number");
    expect(typeof r.typingMaxMs).toBe("number");
    expect(r.typingMinMs).toBeGreaterThanOrEqual(0);
  });

  it("既読モード: 個別 'delayed' は採用、未知/未設定は 'immediate' に正規化", () => {
    expect(resolveMessageTimingConfig({ ...base, read_receipt_mode: "delayed" }).readReceiptMode).toBe("delayed");
    expect(resolveMessageTimingConfig(base).readReceiptMode).toBe("immediate");
  });
});
