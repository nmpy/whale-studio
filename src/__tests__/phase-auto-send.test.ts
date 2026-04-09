/**
 * src/__tests__/phase-auto-send.test.ts
 *
 * フェーズ内メッセージの自動連続送信ロジック検証テスト
 *
 * 検証シナリオ:
 *  1. 通常要素のみ4連続 → 全件送信
 *  2. 通常 → 通常 → トリガー付き → トリガーで停止
 *  3. 通常メッセージ → 通常パズル → パズルで停止
 *  4. 開始フェーズでも通常要素が連続送信される
 *  5. 正解/不正解分岐つきメッセージは自動送信されない
 *  6. パズル正解後の継続送信（startAfterSortOrder）
 *  7. nextMessageId チェーン内での停止と継続
 *  8. response / hint は自動送信されない
 */

import { describe, it, expect, beforeEach } from "vitest";
import { drainAutoSendableItems } from "@/lib/runtime";

// ── テスト用ファクトリ ──────────────────────────

type PhaseMessage = Parameters<typeof drainAutoSendableItems>[0][number];

let _counter = 0;

/**
 * テスト用のメッセージ行を生成する。
 * 最低限のフィールドのみ設定し、テストケースごとにオーバーライド可能。
 */
function makeMessage(overrides: Partial<PhaseMessage> = {}): PhaseMessage {
  _counter++;
  const id = overrides.id ?? `msg-${_counter}`;
  return {
    id,
    workId:              "work-1",
    phaseId:             "phase-1",
    characterId:         null,
    messageType:         "text",
    body:                `メッセージ ${id}`,
    assetUrl:            null,
    altText:             null,
    flexPayloadJson:     null,
    quickReplies:        null,
    sortOrder:           _counter,
    isActive:            true,
    createdAt:           new Date("2024-01-01"),
    updatedAt:           new Date("2024-01-01"),
    kind:                "normal",
    triggerKeyword:      null,
    targetSegment:       null,
    notifyText:          null,
    riddleId:            null,
    answer:              null,
    answerMatchType:     '["exact"]',
    correctAction:       null,
    correctNextPhaseId:  null,
    correctText:         null,
    incorrectText:       null,
    incorrectQuickReplies: null,
    puzzleHintText:      null,
    puzzleType:          null,
    nextMessageId:       null,
    lagMs:               0,
    hintMode:            "always",
    readReceiptMode:     null,
    readDelayMs:         null,
    typingEnabled:       null,
    typingMinMs:         null,
    typingMaxMs:         null,
    loadingEnabled:      null,
    loadingThresholdMs:  null,
    loadingMinSeconds:   null,
    loadingMaxSeconds:   null,
    tapDestinationId:    null,
    tapUrl:              null,
    character:           null,
    ...overrides,
  } as PhaseMessage;
}

// カウンターリセット
function resetCounter() { _counter = 0; }

// ── テストスイート ──────────────────────────

describe("drainAutoSendableItems", () => {
  beforeEach(() => resetCounter());

  // ──────────────────────────────────────────
  // 1. 通常要素のみ4連続
  // ──────────────────────────────────────────
  it("通常メッセージ4件 → フェーズ突入で全件送信", () => {
    const messages = [
      makeMessage({ id: "m1", sortOrder: 1, messageType: "text", body: "テキスト1" }),
      makeMessage({ id: "m2", sortOrder: 2, messageType: "image", assetUrl: "https://example.com/img.jpg" }),
      makeMessage({ id: "m3", sortOrder: 3, messageType: "text", body: "テキスト2" }),
      makeMessage({ id: "m4", sortOrder: 4, messageType: "text", body: "テキスト3" }),
    ];

    const result = drainAutoSendableItems(messages, "in_progress");

    expect(result).toHaveLength(4);
    expect(result.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  // ──────────────────────────────────────────
  // 2. 通常 → 通常 → トリガー付き → 停止
  // ──────────────────────────────────────────
  it("通常2件 + トリガー付き1件 → 最初の2件のみ送信", () => {
    const messages = [
      makeMessage({ id: "m1", sortOrder: 1 }),
      makeMessage({ id: "m2", sortOrder: 2 }),
      makeMessage({
        id: "m3", sortOrder: 3,
        kind: "normal",
        triggerKeyword: "特定キーワード",
      }),
    ];

    const result = drainAutoSendableItems(messages, "in_progress");

    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  // ──────────────────────────────────────────
  // 3. 通常メッセージ → 通常パズル → 停止
  // ──────────────────────────────────────────
  it("通常メッセージ + 通常パズル → パズルまで送信して停止", () => {
    const messages = [
      makeMessage({ id: "m1", sortOrder: 1, body: "導入テキスト" }),
      makeMessage({
        id: "puzzle1", sortOrder: 2,
        kind: "puzzle",
        body: "この謎を解け",
        answer: "答え",
      }),
      makeMessage({ id: "m3", sortOrder: 3, body: "パズル後のテキスト" }),
    ];

    const result = drainAutoSendableItems(messages, "in_progress");

    // パズルは送信されるが、パズル後のメッセージは送信されない
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(["m1", "puzzle1"]);
  });

  // ──────────────────────────────────────────
  // 4. 開始フェーズでも通常要素が連続送信される
  // ──────────────────────────────────────────
  it("kind=start のメッセージも含めて連続送信される", () => {
    const messages = [
      makeMessage({ id: "s1", sortOrder: 1, kind: "start", body: "開始演出1" }),
      makeMessage({ id: "m1", sortOrder: 2, kind: "normal", body: "通常メッセージ1" }),
      makeMessage({ id: "m2", sortOrder: 3, kind: "normal", body: "通常メッセージ2" }),
    ];

    const result = drainAutoSendableItems(messages, "in_progress");

    expect(result).toHaveLength(3);
    expect(result.map((m) => m.id)).toEqual(["s1", "m1", "m2"]);
  });

  // ──────────────────────────────────────────
  // 5. response / hint は自動送信されない
  // ──────────────────────────────────────────
  it("response / hint は自動送信対象外", () => {
    const messages = [
      makeMessage({ id: "m1", sortOrder: 1, kind: "normal", body: "通常" }),
      makeMessage({ id: "r1", sortOrder: 2, kind: "response", body: "キーワード応答", triggerKeyword: "ヒント" }),
      makeMessage({ id: "h1", sortOrder: 3, kind: "hint", body: "ヒントテキスト" }),
      makeMessage({ id: "m2", sortOrder: 4, kind: "normal", body: "通常2" }),
    ];

    const result = drainAutoSendableItems(messages, "in_progress");

    // response と hint はスキップされ、通常メッセージのみ送信
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  // ──────────────────────────────────────────
  // 6. パズル正解後の継続送信（startAfterSortOrder）
  // ──────────────────────────────────────────
  it("startAfterSortOrder 指定で特定 sortOrder 以降のメッセージをドレイン", () => {
    const messages = [
      makeMessage({ id: "m1", sortOrder: 1, body: "パズル前" }),
      makeMessage({
        id: "puzzle1", sortOrder: 2,
        kind: "puzzle",
        body: "謎",
        answer: "答え",
      }),
      makeMessage({ id: "m3", sortOrder: 3, body: "パズル後1" }),
      makeMessage({ id: "m4", sortOrder: 4, body: "パズル後2" }),
    ];

    // sortOrder=2（パズル）以降からドレイン
    const result = drainAutoSendableItems(messages, "in_progress", 2);

    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(["m3", "m4"]);
  });

  it("startAfterSortOrder 以降にパズルがある場合はそこで停止", () => {
    const messages = [
      makeMessage({ id: "puzzle1", sortOrder: 1, kind: "puzzle", answer: "答え1" }),
      makeMessage({ id: "m2", sortOrder: 2, body: "中間テキスト" }),
      makeMessage({ id: "puzzle2", sortOrder: 3, kind: "puzzle", answer: "答え2" }),
      makeMessage({ id: "m4", sortOrder: 4, body: "最後のテキスト" }),
    ];

    // パズル1の後から → m2 + puzzle2 で停止
    const result = drainAutoSendableItems(messages, "in_progress", 1);

    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(["m2", "puzzle2"]);
  });

  // ──────────────────────────────────────────
  // 7. nextMessageId チェーン内での停止と継続
  // ──────────────────────────────────────────
  it("nextMessageId チェーンを辿って連続送信する", () => {
    const messages = [
      makeMessage({ id: "m1", sortOrder: 1, nextMessageId: "m2" }),
      makeMessage({ id: "m2", sortOrder: 2, nextMessageId: "m3" }),
      makeMessage({ id: "m3", sortOrder: 3 }),
    ];

    const result = drainAutoSendableItems(messages, "in_progress");

    expect(result).toHaveLength(3);
    expect(result.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("nextMessageId チェーン内でパズルに到達したら停止", () => {
    const messages = [
      makeMessage({ id: "m1", sortOrder: 1, nextMessageId: "m2" }),
      makeMessage({ id: "m2", sortOrder: 2, nextMessageId: "puzzle1" }),
      makeMessage({ id: "puzzle1", sortOrder: 3, kind: "puzzle", answer: "答え", nextMessageId: "m4" }),
      makeMessage({ id: "m4", sortOrder: 4, body: "パズル後" }),
    ];

    const result = drainAutoSendableItems(messages, "in_progress");

    // パズルまで送信し、パズル後は送信されない
    expect(result).toHaveLength(3);
    expect(result.map((m) => m.id)).toEqual(["m1", "m2", "puzzle1"]);
  });

  // ──────────────────────────────────────────
  // 8. QR 付きメッセージで停止
  // ──────────────────────────────────────────
  it("quickReplies 付きメッセージで停止する", () => {
    const qrJson = JSON.stringify([{ label: "選択肢A", action: "text", value: "A" }]);
    const messages = [
      makeMessage({ id: "m1", sortOrder: 1, body: "導入" }),
      makeMessage({ id: "m2", sortOrder: 2, body: "選択してください", quickReplies: qrJson }),
      makeMessage({ id: "m3", sortOrder: 3, body: "QR後のテキスト" }),
    ];

    const result = drainAutoSendableItems(messages, "in_progress");

    // QR メッセージまで送信して停止
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  // ──────────────────────────────────────────
  // 9. QR の target_message_id で参照されるメッセージは非表示
  // ──────────────────────────────────────────
  it("QR target_message_id で参照されるメッセージはスキップ", () => {
    const qrJson = JSON.stringify([{ label: "次へ", action: "text", target_message_id: "hidden" }]);
    const messages = [
      makeMessage({ id: "m1", sortOrder: 1, quickReplies: qrJson }),
      makeMessage({ id: "hidden", sortOrder: 2, body: "QRタップ時のみ表示" }),
    ];

    const result = drainAutoSendableItems(messages, "in_progress");

    // m1 は QR 付きなので送信して停止。hidden はスキップ。
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("m1");
  });

  // ──────────────────────────────────────────
  // 10. puzzle の targetSegment 不一致はスキップ
  // ──────────────────────────────────────────
  it("puzzle の targetSegment が不一致ならスキップして続行", () => {
    const messages = [
      makeMessage({ id: "m1", sortOrder: 1, body: "テキスト1" }),
      makeMessage({
        id: "puzzle_completed", sortOrder: 2,
        kind: "puzzle",
        answer: "答え",
        targetSegment: "completed", // in_progress ユーザーには表示しない
      }),
      makeMessage({ id: "m3", sortOrder: 3, body: "テキスト2" }),
    ];

    const result = drainAutoSendableItems(messages, "in_progress");

    // puzzle はスキップされ、m1 と m3 が送信される
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(["m1", "m3"]);
  });

  // ──────────────────────────────────────────
  // 11. 空フェーズ
  // ──────────────────────────────────────────
  it("メッセージ0件 → 空配列を返す", () => {
    const result = drainAutoSendableItems([], "in_progress");
    expect(result).toEqual([]);
  });

  // ──────────────────────────────────────────
  // 12. kind=start + triggerKeyword は自動表示される
  // ──────────────────────────────────────────
  it("kind=start は triggerKeyword があっても自動表示対象", () => {
    const messages = [
      makeMessage({
        id: "s1", sortOrder: 1,
        kind: "start",
        triggerKeyword: "はじまり",
        body: "開始演出",
      }),
      makeMessage({ id: "m1", sortOrder: 2, body: "続き" }),
    ];

    const result = drainAutoSendableItems(messages, "in_progress");

    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(["s1", "m1"]);
  });

  // ──────────────────────────────────────────
  // 13. 混合シナリオ: 通常 → 通常 → puzzle → 通常（パズル後は送信しない）
  //     + startAfterSortOrder でパズル後を継続送信
  // ──────────────────────────────────────────
  it("フルシナリオ: フェーズ突入→パズルで停止→正解後に残りを送信", () => {
    const messages = [
      makeMessage({ id: "m1", sortOrder: 1, body: "導入" }),
      makeMessage({ id: "m2", sortOrder: 2, messageType: "image", assetUrl: "https://example.com/img.jpg" }),
      makeMessage({ id: "puzzle1", sortOrder: 3, kind: "puzzle", body: "謎を解け", answer: "42" }),
      makeMessage({ id: "m4", sortOrder: 4, body: "パズル後のテキスト" }),
      makeMessage({ id: "m5", sortOrder: 5, body: "エピローグ" }),
    ];

    // フェーズ突入時: m1, m2, puzzle1 まで
    const entryResult = drainAutoSendableItems(messages, "in_progress");
    expect(entryResult).toHaveLength(3);
    expect(entryResult.map((m) => m.id)).toEqual(["m1", "m2", "puzzle1"]);

    // パズル正解後: puzzle1(sortOrder=3) 以降をドレイン
    const afterPuzzle = drainAutoSendableItems(messages, "in_progress", 3);
    expect(afterPuzzle).toHaveLength(2);
    expect(afterPuzzle.map((m) => m.id)).toEqual(["m4", "m5"]);
  });

  // ──────────────────────────────────────────
  // UI ラベルと runtime 判定の整合性テスト
  // ──────────────────────────────────────────

  describe("UIラベルとランタイム判定の一致", () => {

    // UI「通常」(kind=normal) のメッセージは自動送信される
    it("UI「通常」(kind=normal) の message は自動送信される", () => {
      const messages = [
        makeMessage({ id: "n1", sortOrder: 1, kind: "normal", body: "通常メッセージ1" }),
        makeMessage({ id: "n2", sortOrder: 2, kind: "normal", body: "通常メッセージ2" }),
        makeMessage({ id: "n3", sortOrder: 3, kind: "normal", body: "通常メッセージ3" }),
      ];

      const result = drainAutoSendableItems(messages, "in_progress");

      expect(result).toHaveLength(3);
      expect(result.every((m) => m.id.startsWith("n"))).toBe(true);
    });

    // UI「謎」(kind=puzzle) の correctText / incorrectText は独立メッセージではないため
    // 自動送信の対象にならない（パズルメッセージの内部属性として handlePuzzleCorrect が処理する）
    it("puzzle の correctText/incorrectText は独立メッセージではなく自動送信されない", () => {
      // correctText / incorrectText はパズルメッセージの属性であり、
      // 独立した Message 行として存在しない。
      // ここでは puzzle メッセージ自体が送信されるが停止することを確認する。
      const messages = [
        makeMessage({ id: "m1", sortOrder: 1, kind: "normal" }),
        makeMessage({
          id: "puzzle1", sortOrder: 2,
          kind: "puzzle",
          body: "謎を解け",
          answer: "答え",
          correctText: "正解！すごい！",     // DB属性（別メッセージではない）
          incorrectText: "残念、もう一度",    // DB属性（別メッセージではない）
          correctAction: "text",
        }),
        makeMessage({ id: "m3", sortOrder: 3, kind: "normal", body: "パズル後" }),
      ];

      const result = drainAutoSendableItems(messages, "in_progress");

      // puzzle まで送信して停止。correctText/incorrectText は含まれない。
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(["m1", "puzzle1"]);
      // result にはパズルの body は含まれるが、correctText/incorrectText は RuntimePhaseMessage に含まれない
    });

    // UI「応答」(kind=response) は自動送信されない
    it("UI「応答」(kind=response) の message は自動送信されない", () => {
      const messages = [
        makeMessage({ id: "n1", sortOrder: 1, kind: "normal", body: "通常" }),
        makeMessage({
          id: "r1", sortOrder: 2,
          kind: "response",
          triggerKeyword: "特定キーワード",
          body: "キーワード応答テキスト",
        }),
        makeMessage({ id: "n2", sortOrder: 3, kind: "normal", body: "通常2" }),
      ];

      const result = drainAutoSendableItems(messages, "in_progress");

      // response はスキップされ、通常メッセージのみ
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(["n1", "n2"]);
    });

    // UI「通常」だが quickReplies がある場合 → 送信されるが停止する
    it("kind=normal + quickReplies → 送信されるがそこで停止", () => {
      const qrJson = JSON.stringify([{ label: "はい", action: "text", value: "はい" }]);
      const messages = [
        makeMessage({ id: "n1", sortOrder: 1, kind: "normal", body: "まず説明" }),
        makeMessage({
          id: "n2", sortOrder: 2,
          kind: "normal",
          body: "選んでください",
          quickReplies: qrJson,
        }),
        makeMessage({ id: "n3", sortOrder: 3, kind: "normal", body: "QR後のテキスト" }),
      ];

      const result = drainAutoSendableItems(messages, "in_progress");

      // n1 と n2 は送信。n2 で停止（quickReplies が待機ポイント）
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(["n1", "n2"]);
    });

    // kind と triggerKeyword の「不整合」データでも安全に動作する
    // （kind=normal だが triggerKeyword が設定されている → UI上「通常」だがランタイムでは自動送信対象外）
    it("kind=normal + triggerKeyword 設定 → 自動送信されない（安全側に倒す）", () => {
      const messages = [
        makeMessage({ id: "n1", sortOrder: 1, kind: "normal", body: "通常" }),
        makeMessage({
          id: "anomaly", sortOrder: 2,
          kind: "normal",           // UI上は「通常」ラベル
          triggerKeyword: "合言葉", // だがキーワードが設定されている
          body: "合言葉に反応するテキスト",
        }),
        makeMessage({ id: "n3", sortOrder: 3, kind: "normal", body: "通常3" }),
      ];

      const result = drainAutoSendableItems(messages, "in_progress");

      // anomaly は triggerKeyword があるため自動送信対象外（安全側に倒す）
      // n1 と n3 のみ送信される
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(["n1", "n3"]);
    });

    // kind=response だが triggerKeyword が未設定（不整合データ）→ 安全に除外される
    it("kind=response + triggerKeyword 未設定（不整合）→ 自動送信されない", () => {
      const messages = [
        makeMessage({ id: "n1", sortOrder: 1, kind: "normal" }),
        makeMessage({
          id: "bad", sortOrder: 2,
          kind: "response",          // 応答だが
          triggerKeyword: null,       // キーワード未設定（不整合）
          body: "不整合データ",
        }),
        makeMessage({ id: "n3", sortOrder: 3, kind: "normal" }),
      ];

      const result = drainAutoSendableItems(messages, "in_progress");

      // kind=response は triggerKeyword の有無に関係なく自動送信対象外
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(["n1", "n3"]);
    });
  });
});
