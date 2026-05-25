// src/__tests__/phase-2c-per-message-runtime-timing.test.ts
//
// Phase 2c: msg2 以降の per-message timing が LINE 実機まで届くことを担保するテスト。
//
// 検証対象:
//   1. convertMessageToLine (= buildPhaseMessages 経由) で
//      RuntimePhaseMessage.timing が LineMessage._timing として搬送される
//   2. moveQuickReplyToTail 適用後も _timing が残る
//   3. ReadReceiptController.waitTypingForMessage が per-message 設定で typing 待機する
//   4. 既存単発メッセージの演出挙動が壊れない

import { describe, it, expect } from "vitest";
import { buildPhaseMessages, type LineTextMessage } from "@/lib/line";
import { ReadReceiptController } from "@/lib/line-read-receipt";
import { moveQuickReplyToTail } from "@/lib/quick-reply-tail";
import type { RuntimePhase, MessageTimingConfig } from "@/types";

// ──────────────────────────────────────────────────────────
// テストデータ
// ──────────────────────────────────────────────────────────

const TIMING_MSG2: MessageTimingConfig = {
  read_receipt_mode:    "delayed",
  read_delay_ms:        1500,
  typing_enabled:       true,
  typing_min_ms:        100,
  typing_max_ms:        100,
  loading_enabled:      false,
  loading_threshold_ms: null,
  loading_min_seconds:  null,
  loading_max_seconds:  null,
};

const TIMING_MSG1: MessageTimingConfig = {
  read_receipt_mode:    "immediate",
  read_delay_ms:        null,
  typing_enabled:       false,  // msg1 では typing OFF
  typing_min_ms:        null,
  typing_max_ms:        null,
  loading_enabled:      null,
  loading_threshold_ms: null,
  loading_min_seconds:  null,
  loading_max_seconds:  null,
};

// 共通: ベースの RuntimePhaseMessage プロパティ (全フィールド埋め)
function baseMsg(id: string, body: string, timing: MessageTimingConfig | null) {
  return {
    id,
    kind: "normal",
    message_type: "text" as const,
    body,
    asset_url: null,
    alt_text: null,
    flex_payload_json: null,
    quick_replies: null,
    lag_ms: 0,
    hint_mode: "always" as const,
    sort_order: 0,
    timing,
    tap_destination_id: null,
    tap_url: null,
    image_action_type: null,
    image_action_text: null,
    image_action_url: null,
    image_action_liff_page_id: null,
    image_action_postback_data: null,
    character: null,
  };
}

function basePhase(messages: ReturnType<typeof baseMsg>[]): RuntimePhase {
  return {
    id:           "p-1",
    phase_type:   "normal",
    name:         "テストフェーズ",
    description:  null,
    messages,
    transitions:  [],
    ending_message: null,
  } as unknown as RuntimePhase;
}

// ──────────────────────────────────────────────────────────
// 1. convertMessageToLine で timing が搬送される
// ──────────────────────────────────────────────────────────

describe("Phase 2c: buildPhaseMessages → LineMessage._timing 搬送", () => {
  it("msg1 / msg2 それぞれの timing が _timing として LineMessage に乗る", () => {
    const phase = basePhase([
      baseMsg("m1", "msg1 body", TIMING_MSG1),
      baseMsg("m2", "msg2 body", TIMING_MSG2),
    ]);
    const out = buildPhaseMessages(phase);
    expect(out.length).toBe(2);
    const m1 = out[0] as LineTextMessage;
    const m2 = out[1] as LineTextMessage;
    expect(m1._timing).toEqual(TIMING_MSG1);
    expect(m2._timing).toEqual(TIMING_MSG2);
  });

  it("timing が null の chain では _timing が undefined のままになる (= inherit)", () => {
    const phase = basePhase([
      baseMsg("m1", "msg1", null),
      baseMsg("m2", "msg2", null),
    ]);
    const out = buildPhaseMessages(phase);
    expect((out[0] as LineTextMessage)._timing).toBeUndefined();
    expect((out[1] as LineTextMessage)._timing).toBeUndefined();
  });

  it("msg2 だけ timing が設定された場合、msg1 は _timing なし / msg2 は _timing あり", () => {
    const phase = basePhase([
      baseMsg("m1", "msg1", null),
      baseMsg("m2", "msg2", TIMING_MSG2),
    ]);
    const out = buildPhaseMessages(phase);
    expect((out[0] as LineTextMessage)._timing).toBeUndefined();
    expect((out[1] as LineTextMessage)._timing).toEqual(TIMING_MSG2);
  });

  it("typing_enabled=false が _timing に残り、null inherit と混同されない", () => {
    const phase = basePhase([
      baseMsg("m1", "msg1", { ...TIMING_MSG1, typing_enabled: false }),
    ]);
    const out = buildPhaseMessages(phase);
    expect((out[0] as LineTextMessage)._timing?.typing_enabled).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// 2. moveQuickReplyToTail 適用後も _timing が保持される
// ──────────────────────────────────────────────────────────

describe("Phase 2c: QR tail 移動後の _timing 保持", () => {
  it("msg1 の QR を msg2 へ tail 移動しても、msg1 / msg2 の _timing は維持される", () => {
    type Msg = { type: "text"; text: string; _timing?: MessageTimingConfig; quickReply?: { items: unknown[] } };
    const qr = { items: [{ label: "next" }] };
    const msgs: Msg[] = [
      { type: "text", text: "msg1", _timing: TIMING_MSG1, quickReply: qr },
      { type: "text", text: "msg2", _timing: TIMING_MSG2 },
    ];
    moveQuickReplyToTail(msgs);
    // QR は移動した
    expect(msgs[0].quickReply).toBeUndefined();
    expect(msgs[1].quickReply).toBe(qr);
    // timing は触られていない (msg1, msg2 それぞれそのまま)
    expect(msgs[0]._timing).toEqual(TIMING_MSG1);
    expect(msgs[1]._timing).toEqual(TIMING_MSG2);
  });

  it("buildPhaseMessages の chain で QR を tail 移動した後でも、msg2._timing が落ちない", () => {
    const m1 = baseMsg("m1", "msg1", TIMING_MSG1);
    m1.quick_replies = [{ label: "次へ", action: "text" as const, value: "next" }];
    const m2 = baseMsg("m2", "msg2", TIMING_MSG2);
    const phase: RuntimePhase = {
      ...basePhase([m1, m2]),
      transitions: [],  // QR 移動が走るシナリオ
    };
    const out = buildPhaseMessages(phase);
    expect(out.length).toBe(2);
    // QR は msg2 (tail) に集約
    expect((out[0] as LineTextMessage).quickReply).toBeUndefined();
    expect((out[1] as LineTextMessage).quickReply).toBeDefined();
    // timing は保持
    expect((out[0] as LineTextMessage)._timing).toEqual(TIMING_MSG1);
    expect((out[1] as LineTextMessage)._timing).toEqual(TIMING_MSG2);
  });
});

// ──────────────────────────────────────────────────────────
// 3. ReadReceiptController.waitTypingForMessage の挙動
// ──────────────────────────────────────────────────────────

describe("Phase 2c: ReadReceiptController.waitTypingForMessage", () => {
  function makeCtrl() {
    return new ReadReceiptController({
      userId:             "u-test",
      channelAccessToken: "tok",
      isOneOnOne:         true,
      // typing は msg 個別設定が支配的になるよう env default は無効化
      config: { typingEnabled: false, typingMinMs: 0, typingMaxMs: 0 },
    });
  }

  it("typing_enabled=true / typing_min=typing_max=100 で約 100ms 待機する", async () => {
    const ctrl = makeCtrl();
    const t0 = Date.now();
    await ctrl.waitTypingForMessage({
      ...TIMING_MSG2,
      typing_enabled: true, typing_min_ms: 100, typing_max_ms: 100,
    });
    const elapsed = Date.now() - t0;
    // 50ms 以下スキップ閾値を超えて待機している
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(400);
  });

  it("typing_enabled=false なら即 return (= 待機しない)", async () => {
    const ctrl = makeCtrl();
    const t0 = Date.now();
    await ctrl.waitTypingForMessage({
      ...TIMING_MSG2,
      typing_enabled: false, typing_min_ms: 500, typing_max_ms: 500,
    });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });

  it("msgConfig=null でも env が無効なら何もしない", async () => {
    const ctrl = makeCtrl();
    const t0 = Date.now();
    await ctrl.waitTypingForMessage(null);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });

  it("typing_min=10/typing_max=20 の極小値は 50ms 閾値でスキップされる", async () => {
    const ctrl = makeCtrl();
    const t0 = Date.now();
    await ctrl.waitTypingForMessage({
      ...TIMING_MSG2,
      typing_enabled: true, typing_min_ms: 10, typing_max_ms: 20,
    });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });

  it("receivedAt の経過時間に依存しない (= waitTypingBeforeReply とは別物)", async () => {
    // 古い receivedAt (= 既に 10 秒経過扱い) でも、per-message typing は効く
    const ctrl = new ReadReceiptController({
      userId:             "u-test",
      channelAccessToken: "tok",
      isOneOnOne:         true,
      receivedAt:         Date.now() - 10000,
      config: { typingEnabled: false },
    });
    const t0 = Date.now();
    await ctrl.waitTypingForMessage({
      ...TIMING_MSG2,
      typing_enabled: true, typing_min_ms: 100, typing_max_ms: 100,
    });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });
});

// ──────────────────────────────────────────────────────────
// 4. Phase 2c hotfix: abortPendingLoading / showLoadingForMessage
// ──────────────────────────────────────────────────────────

describe("Phase 2c hotfix: abortPendingLoading / showLoadingForMessage", () => {
  it("abortPendingLoading を呼ぶと、scheduled な loading は発火しない", async () => {
    const ctrl = new ReadReceiptController({
      userId:             "u-test",
      channelAccessToken: "tok",
      isOneOnOne:         true,
      // loading threshold を小さくして即発火しそうな状態にする
      config: { loadingEnabled: true, loadingThresholdMs: 50, loadingMinSeconds: 5, loadingMaxSeconds: 15 },
    });
    // resolvedTiming を inherit のままにしておくと、env (loadingEnabled=true) が効く
    let loadingCalled = false;
    // showLoadingNow を pass-through する spy 代わりに、内部 fetch を avoid するため
    // loadingShown 状態が更新されるかで判定する。
    // ここでは scheduleLoading → setTimeout(50ms) → showLoadingNow を予約。
    ctrl.scheduleLoading();
    ctrl.abortPendingLoading();
    await new Promise((r) => setTimeout(r, 120));
    const log = ctrl.getTimingLog();
    // 発火していなければ loadingStartedAt は null のまま
    expect(log.loadingStartedAt).toBeNull();
    void loadingCalled;
  });

  it("showLoadingForMessage は msgConfig.loading_enabled=true のときのみ発火を試みる", async () => {
    const ctrl = new ReadReceiptController({
      userId:             "u-test",
      channelAccessToken: "tok",
      isOneOnOne:         true,
      config: { loadingEnabled: false },  // env では disabled
    });
    // loading_enabled=null (= inherit) は env が disabled なので no-op
    await ctrl.showLoadingForMessage({
      ...TIMING_MSG2,
      loading_enabled: null,
    });
    expect(ctrl.getTimingLog().loadingStartedAt).toBeNull();
  });

  it("showLoadingForMessage は msgConfig.loading_enabled=false なら何もしない", async () => {
    const ctrl = new ReadReceiptController({
      userId:             "u-test",
      channelAccessToken: "tok",
      isOneOnOne:         true,
      config: { loadingEnabled: true },
    });
    await ctrl.showLoadingForMessage({
      ...TIMING_MSG2,
      loading_enabled: false,
    });
    expect(ctrl.getTimingLog().loadingStartedAt).toBeNull();
  });

  it("isOneOnOne=false (= グループトーク) では showLoadingForMessage は no-op", async () => {
    const ctrl = new ReadReceiptController({
      userId:             "u-test",
      channelAccessToken: "tok",
      isOneOnOne:         false,
      config: { loadingEnabled: true },
    });
    await ctrl.showLoadingForMessage({
      ...TIMING_MSG2,
      loading_enabled: true,
    });
    expect(ctrl.getTimingLog().loadingStartedAt).toBeNull();
  });

  it("abortPendingLoading を 2 回呼んでも例外にならない", () => {
    const ctrl = new ReadReceiptController({
      userId: "u-test", channelAccessToken: "tok", isOneOnOne: true,
    });
    ctrl.abortPendingLoading();
    expect(() => ctrl.abortPendingLoading()).not.toThrow();
  });
});

// ──────────────────────────────────────────────────────────
// 5. Phase 2c hotfix v2: msg1 typing もreceivedAt 非依存で安定する
// ──────────────────────────────────────────────────────────

describe("Phase 2c hotfix v2: msg1 typing は receivedAt 経過時間でスキップされない", () => {
  it("waitTypingForMessage は受信から 5 秒経過していても typing_min ms 待機する", async () => {
    // Phase 2c hotfix v2 のコアシナリオ:
    // cold start で webhook 受信から msg1 送信まで数秒経過していても、
    // msg1 に typing_enabled=true / typing_min_ms=1500 があれば必ず 1.5 秒待つ。
    const ctrl = new ReadReceiptController({
      userId:             "u-test",
      channelAccessToken: "tok",
      isOneOnOne:         true,
      receivedAt:         Date.now() - 5000,  // 5 秒前に受信した想定
      // env では typing OFF (= msg 設定が支配的になるよう)
      config: { typingEnabled: false, loadingThresholdMs: 3000 },
    });
    const t0 = Date.now();
    await ctrl.waitTypingForMessage({
      read_receipt_mode: null, read_delay_ms: null,
      typing_enabled: true, typing_min_ms: 200, typing_max_ms: 200,
      loading_enabled: null, loading_threshold_ms: null,
      loading_min_seconds: null, loading_max_seconds: null,
    });
    const elapsed = Date.now() - t0;
    // 200ms 待機している (= 経過時間 5 秒 > loadingThresholdMs 3 秒 でもスキップされない)
    expect(elapsed).toBeGreaterThanOrEqual(180);
  });

  it("対照: waitTypingBeforeReply は受信から loadingThresholdMs 経過するとスキップする (= 既存挙動)", async () => {
    // 既存の waitTypingBeforeReply は意図的に「処理が遅いときは typing を出さない」設計。
    // hotfix v2 は msg1 で waitTypingForMessage を使うことでこの問題を回避している。
    const ctrl = new ReadReceiptController({
      userId:             "u-test",
      channelAccessToken: "tok",
      isOneOnOne:         true,
      receivedAt:         Date.now() - 5000,  // 5 秒前に受信
      config: { typingEnabled: true, typingMinMs: 200, typingMaxMs: 200, loadingThresholdMs: 3000 },
    });
    const t0 = Date.now();
    await ctrl.waitTypingBeforeReply();
    const elapsed = Date.now() - t0;
    // 既存挙動: 経過時間 > loadingThresholdMs なのでスキップ
    expect(elapsed).toBeLessThan(50);
  });
});
