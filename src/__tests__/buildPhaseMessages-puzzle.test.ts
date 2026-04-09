/**
 * src/__tests__/buildPhaseMessages-puzzle.test.ts
 *
 * buildPhaseMessages が puzzle メッセージを LINE メッセージに正しく変換するか検証する。
 * drainAutoSendableItems (runtime.ts) → buildPhaseMessages (line.ts) の
 * 統合パイプラインをテストする。
 *
 * テスト対象:
 *  1. text puzzle が text LINE メッセージに変換される
 *  2. image puzzle が image LINE メッセージに変換される
 *  3. carousel puzzle がフォールバック text に変換される
 *  4. normal text + puzzle text が 2件の LINE メッセージになる
 *  5. message_type が未対応でもクラッシュしない
 */

import { describe, it, expect } from "vitest";
import { buildPhaseMessages } from "@/lib/line";
import type { RuntimePhase, RuntimePhaseMessage } from "@/types";

/** テスト用 RuntimePhaseMessage を生成する */
function makeRuntimeMsg(overrides: Partial<RuntimePhaseMessage> = {}): RuntimePhaseMessage {
  return {
    id:                 "msg-1",
    message_type:       "text",
    body:               "テストメッセージ",
    asset_url:          null,
    alt_text:           null,
    flex_payload_json:  null,
    quick_replies:      null,
    lag_ms:             0,
    hint_mode:          "always",
    sort_order:         0,
    timing:             null,
    tap_destination_id: null,
    tap_url:            null,
    character:          null,
    ...overrides,
  };
}

/** テスト用 RuntimePhase を生成する */
function makePhase(messages: RuntimePhaseMessage[], overrides: Partial<RuntimePhase> = {}): RuntimePhase {
  return {
    id:          "phase-1",
    phase_type:  "normal",
    name:        "テストフェーズ",
    description: null,
    messages,
    transitions: [],
    ...overrides,
  };
}

describe("buildPhaseMessages — puzzle 変換", () => {

  it("text puzzle (body あり) → text LINE メッセージに変換される", () => {
    const phase = makePhase([
      makeRuntimeMsg({ id: "puzzle-1", message_type: "text", body: "この謎を解け！" }),
    ]);

    const result = buildPhaseMessages(phase);

    // text + body → LINE text message
    const textMsgs = result.filter((m) => m.type === "text");
    expect(textMsgs.length).toBeGreaterThanOrEqual(1);
    expect(textMsgs.some((m) => "text" in m && (m as { text: string }).text.includes("この謎を解け"))).toBe(true);
  });

  it("image puzzle (asset_url あり) → image LINE メッセージに変換される", () => {
    const phase = makePhase([
      makeRuntimeMsg({
        id: "puzzle-2",
        message_type: "image",
        body: null,
        asset_url: "https://example.com/puzzle.jpg",
      }),
    ]);

    const result = buildPhaseMessages(phase);

    const imageMsgs = result.filter((m) => m.type === "image");
    expect(imageMsgs.length).toBeGreaterThanOrEqual(1);
  });

  it("carousel puzzle → フォールバック text に変換される（黙って消えない）", () => {
    const phase = makePhase([
      makeRuntimeMsg({
        id: "puzzle-3",
        message_type: "carousel" as RuntimePhaseMessage["message_type"],
        body: JSON.stringify([{ title: "選択肢1" }]),
        alt_text: "カルーセルの説明",
      }),
    ]);

    const result = buildPhaseMessages(phase);

    // carousel はフォールバック text として送信される
    const textMsgs = result.filter((m) => m.type === "text");
    expect(textMsgs.length).toBeGreaterThanOrEqual(1);
  });

  it("normal text + puzzle text → 2件の LINE メッセージになる", () => {
    const phase = makePhase([
      makeRuntimeMsg({ id: "m1", sort_order: 0, message_type: "text", body: "導入テキスト" }),
      makeRuntimeMsg({ id: "puzzle-1", sort_order: 1, message_type: "text", body: "この謎を解け！" }),
    ]);

    const result = buildPhaseMessages(phase);

    // 2件のメッセージ + 遷移QR(transitions=[]のため「続きを選んでください」テキスト可能性あり)
    // 少なくとも 2件の text が含まれる
    const textMsgs = result.filter((m) => m.type === "text");
    expect(textMsgs.length).toBeGreaterThanOrEqual(2);
  });

  it("normal text + image puzzle → text + image の 2件になる", () => {
    const phase = makePhase([
      makeRuntimeMsg({ id: "m1", sort_order: 0, message_type: "text", body: "まず読んでね" }),
      makeRuntimeMsg({
        id: "puzzle-1", sort_order: 1,
        message_type: "image",
        body: null,
        asset_url: "https://example.com/puzzle.jpg",
      }),
    ]);

    const result = buildPhaseMessages(phase);

    expect(result.some((m) => m.type === "text")).toBe(true);
    expect(result.some((m) => m.type === "image")).toBe(true);
  });

  it("未対応 message_type でもクラッシュせず、空にならない（警告のみ）", () => {
    const phase = makePhase([
      makeRuntimeMsg({ id: "m1", sort_order: 0, message_type: "text", body: "正常テキスト" }),
      makeRuntimeMsg({
        id: "m2", sort_order: 1,
        message_type: "voice" as RuntimePhaseMessage["message_type"],
        body: null,
        asset_url: null, // voice だが asset_url もない
      }),
    ]);

    const result = buildPhaseMessages(phase);

    // voice の asset_url が null → 変換されないが、text の m1 は含まれる
    expect(result.some((m) => m.type === "text")).toBe(true);
    // クラッシュしない
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

describe("drainAutoSendableItems → buildPhaseMessages 統合パイプライン", () => {

  // drainAutoSendableItems の出力を buildPhaseMessages に通して
  // 実際に puzzle が LINE メッセージになるかを検証する
  it("同一フェーズの normal text + puzzle text → フェーズ突入で両方送信対象になる", async () => {
    // drainAutoSendableItems をインポート
    const { drainAutoSendableItems } = await import("@/lib/runtime");

    // DB 取得形式に近い PhaseRow["messages"] を構築
    const now = new Date("2024-01-01");
    const phaseMessages = [
      {
        id: "m1", workId: "w1", phaseId: "p1", characterId: null,
        messageType: "text", body: "導入テキスト", assetUrl: null,
        altText: null, flexPayloadJson: null, quickReplies: null,
        sortOrder: 0, isActive: true, createdAt: now, updatedAt: now,
        kind: "normal", triggerKeyword: null, targetSegment: null,
        notifyText: null, riddleId: null,
        answer: null, answerMatchType: '["exact"]',
        correctAction: null, correctNextPhaseId: null,
        correctText: null, incorrectText: null,
        incorrectQuickReplies: null, puzzleHintText: null,
        puzzleType: null, nextMessageId: null, lagMs: 0,
        hintMode: "always",
        readReceiptMode: null, readDelayMs: null,
        typingEnabled: null, typingMinMs: null, typingMaxMs: null,
        loadingEnabled: null, loadingThresholdMs: null,
        loadingMinSeconds: null, loadingMaxSeconds: null,
        tapDestinationId: null, tapUrl: null,
        character: null,
      },
      {
        id: "puzzle1", workId: "w1", phaseId: "p1", characterId: null,
        messageType: "text", body: "この謎を解いてください", assetUrl: null,
        altText: null, flexPayloadJson: null, quickReplies: null,
        sortOrder: 1, isActive: true, createdAt: now, updatedAt: now,
        kind: "puzzle", triggerKeyword: null, targetSegment: null,
        notifyText: null, riddleId: null,
        answer: "42", answerMatchType: '["exact"]',
        correctAction: "text", correctNextPhaseId: null,
        correctText: "正解！", incorrectText: "不正解",
        incorrectQuickReplies: null, puzzleHintText: null,
        puzzleType: "text", nextMessageId: null, lagMs: 0,
        hintMode: "always",
        readReceiptMode: null, readDelayMs: null,
        typingEnabled: null, typingMinMs: null, typingMaxMs: null,
        loadingEnabled: null, loadingThresholdMs: null,
        loadingMinSeconds: null, loadingMaxSeconds: null,
        tapDestinationId: null, tapUrl: null,
        character: null,
      },
    ];

    // Step 1: drainAutoSendableItems
    const drained = drainAutoSendableItems(phaseMessages as any, "in_progress");
    expect(drained).toHaveLength(2);
    expect(drained[0].id).toBe("m1");
    expect(drained[1].id).toBe("puzzle1");

    // Step 2: buildPhaseMessages
    const phase: RuntimePhase = {
      id: "p1",
      phase_type: "normal",
      name: "テスト",
      description: null,
      messages: drained,
      transitions: null, // エンディング扱い（遷移QR不要）
    };
    const lineMessages = buildPhaseMessages(phase);

    // 2件の text メッセージが生成される
    expect(lineMessages.length).toBeGreaterThanOrEqual(2);
    expect(lineMessages[0].type).toBe("text");
    expect(lineMessages[1].type).toBe("text");
    expect((lineMessages[0] as { text: string }).text).toContain("導入テキスト");
    expect((lineMessages[1] as { text: string }).text).toContain("この謎を解いてください");
  });
});
