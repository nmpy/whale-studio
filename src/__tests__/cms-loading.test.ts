/**
 * src/__tests__/cms-loading.test.ts
 *
 * 「入力中…」(loading animation) は CMS で設定したメッセージだけに、CMS 設定秒に近い形で出す。
 * reply pacing 由来の一律 pre-delay / loading は廃止し、CMS 未設定では loading も待機も入れない。
 *
 * ここでは送信直前プラン解決（resolveCmsLoadingPlan）と loadingSeconds 算出（computeLoadingSeconds）の
 * 純ロジックを検証する（実 LINE API・実時間待機は伴わない）。
 */
import { describe, it, expect } from "vitest";
import { resolveCmsLoadingPlan, computeLoadingSeconds } from "@/lib/line-read-receipt";
import { clampReplyCmsLoadingDelayMs, MAX_REPLY_CMS_LOADING_DELAY_MS } from "@/lib/line";
import type { MessageTimingConfig } from "@/types";

/** loading 設定だけを持つ最小 timing を作る。 */
function timing(over: Partial<MessageTimingConfig> = {}): MessageTimingConfig {
  return {
    read_receipt_mode:    null,
    read_delay_ms:        null,
    typing_enabled:       null,
    typing_min_ms:        null,
    typing_max_ms:        null,
    loading_enabled:      null,
    loading_threshold_ms: null,
    loading_min_seconds:  null,
    loading_max_seconds:  null,
    ...over,
  } as MessageTimingConfig;
}

describe("resolveCmsLoadingPlan — CMS入力中設定 → 送信前プラン", () => {
  it("1. 入力中未設定（timing=null）→ null（loading も待機も無し）", () => {
    expect(resolveCmsLoadingPlan(null)).toBeNull();
    expect(resolveCmsLoadingPlan(undefined)).toBeNull();
  });

  it("1b. loading_enabled=false / null → null（誤付与しない）", () => {
    expect(resolveCmsLoadingPlan(timing({ loading_enabled: false }))).toBeNull();
    expect(resolveCmsLoadingPlan(timing({ loading_enabled: null, loading_max_seconds: 8 }))).toBeNull();
  });

  it("2. 入力中3秒 → loadingSeconds=5・待機3000ms", () => {
    const plan = resolveCmsLoadingPlan(timing({ loading_enabled: true, loading_min_seconds: 3, loading_max_seconds: 3 }))!;
    expect(plan).not.toBeNull();
    expect(plan.cmsSeconds).toBe(3);
    expect(plan.delayMs).toBe(3000);
    expect(plan.loadingSeconds).toBe(5); // 5刻み切り上げ
  });

  it("3. 入力中8秒 → loadingSeconds=10・待機8000ms", () => {
    const plan = resolveCmsLoadingPlan(timing({ loading_enabled: true, loading_min_seconds: 8, loading_max_seconds: 8 }))!;
    expect(plan.cmsSeconds).toBe(8);
    expect(plan.delayMs).toBe(8000);
    expect(plan.loadingSeconds).toBe(10);
  });

  it("min/max レンジは max を採用（3〜8 → 8秒待機・loadingSeconds=10）", () => {
    const plan = resolveCmsLoadingPlan(timing({ loading_enabled: true, loading_min_seconds: 3, loading_max_seconds: 8 }))!;
    expect(plan.cmsSeconds).toBe(8);
    expect(plan.loadingSeconds).toBe(10);
  });

  it("11秒 → loadingSeconds=15（5刻み切り上げ）", () => {
    const plan = resolveCmsLoadingPlan(timing({ loading_enabled: true, loading_max_seconds: 11 }))!;
    expect(plan.loadingSeconds).toBe(15);
    expect(plan.delayMs).toBe(11000);
  });

  it("60秒超は60に丸め（loadingSeconds=60）", () => {
    const plan = resolveCmsLoadingPlan(timing({ loading_enabled: true, loading_max_seconds: 90 }))!;
    expect(plan.cmsSeconds).toBe(60);
    expect(plan.loadingSeconds).toBe(60);
  });

  it("loading_enabled だが秒数未設定 → 既定5秒", () => {
    const plan = resolveCmsLoadingPlan(timing({ loading_enabled: true }))!;
    expect(plan.cmsSeconds).toBe(5);
    expect(plan.loadingSeconds).toBe(5);
    expect(plan.delayMs).toBe(5000);
  });
});

describe("computeLoadingSeconds — 経過×1.5 ヒューリスティック廃止（CMS設定秒を採用）", () => {
  it("経過時間に依存しない（elapsed が大きくても CMS秒のみで決まる）", () => {
    expect(computeLoadingSeconds(20000, 3, 3)).toBe(5);  // CMS3 → 5（経過20sでも膨らまない）
    expect(computeLoadingSeconds(0, 8, 8)).toBe(10);     // CMS8 → 10
    expect(computeLoadingSeconds(99999, 3, 8)).toBe(10); // max採用 → 8 → 10
  });

  it("5刻み切り上げ・5〜60クランプ", () => {
    expect(computeLoadingSeconds(0, 1, 1)).toBe(5);
    expect(computeLoadingSeconds(0, 11, 11)).toBe(15);
    expect(computeLoadingSeconds(0, 90, 90)).toBe(60);
  });
});

describe("clampReplyCmsLoadingDelayMs — reply前待機の安全上限（replyToken保護・秒数変換とは独立）", () => {
  it("上限は30秒", () => {
    expect(MAX_REPLY_CMS_LOADING_DELAY_MS).toBe(30_000);
  });

  it("3秒・8秒は丸めない（clamped=false）", () => {
    expect(clampReplyCmsLoadingDelayMs(3000)).toEqual({ appliedDelayMs: 3000, clamped: false });
    expect(clampReplyCmsLoadingDelayMs(8000)).toEqual({ appliedDelayMs: 8000, clamped: false });
  });

  it("30秒ちょうどは丸めない", () => {
    expect(clampReplyCmsLoadingDelayMs(30_000)).toEqual({ appliedDelayMs: 30_000, clamped: false });
  });

  it("CMS 60秒設定 → reply前実待機は30秒にclamp（clamped=true）", () => {
    expect(clampReplyCmsLoadingDelayMs(60_000)).toEqual({ appliedDelayMs: 30_000, clamped: true });
  });

  it("負値/NaN は0扱い", () => {
    expect(clampReplyCmsLoadingDelayMs(-1)).toEqual({ appliedDelayMs: 0, clamped: false });
    expect(clampReplyCmsLoadingDelayMs(NaN)).toEqual({ appliedDelayMs: 0, clamped: false });
  });
});

describe("CMS 60秒設定: loadingSeconds は60・reply前待機は30秒にclamp（変換と上限の分離）", () => {
  it("resolveCmsLoadingPlan(60秒) は loadingSeconds=60 / delayMs=60000、clamp後は30000", () => {
    const plan = resolveCmsLoadingPlan(timing({ loading_enabled: true, loading_max_seconds: 60 }))!;
    expect(plan.loadingSeconds).toBe(60);   // LINE へ渡す値は CMS 設定どおり
    expect(plan.delayMs).toBe(60_000);      // 秒数変換はそのまま
    const { appliedDelayMs, clamped } = clampReplyCmsLoadingDelayMs(plan.delayMs);
    expect(appliedDelayMs).toBe(30_000);    // reply 前の実待機だけ安全上限で丸める
    expect(clamped).toBe(true);
  });
});
