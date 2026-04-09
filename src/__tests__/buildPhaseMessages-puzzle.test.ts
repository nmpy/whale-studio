/**
 * src/__tests__/buildPhaseMessages-puzzle.test.ts
 *
 * buildPhaseMessages の LINE メッセージ変換を検証する。
 *
 * 検証カテゴリ:
 *   A. 正式対応 type（text/image/video）の正常変換
 *   B. フォールバック type（carousel/voice/riddle/flex/未知型）の安全な変換
 *   C. 必須フィールド欠損時の安全なスキップ
 *   D. puzzle メッセージの変換パイプライン（drain → build 統合）
 *   E. サマリログ検証（複数件のうち一部変換不能ケース）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildPhaseMessages } from "@/lib/line";
import type { RuntimePhase, RuntimePhaseMessage } from "@/types";

// console.warn / console.error をスパイしてログ出力を検証する
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  // console.log は診断用なのでスパイ不要だが、テスト出力を汚さないよう抑制
  vi.spyOn(console, "log").mockImplementation(() => {});
});

/** テスト用 RuntimePhaseMessage を生成する */
function makeMsg(overrides: Partial<RuntimePhaseMessage> = {}): RuntimePhaseMessage {
  return {
    id:                 "msg-default",
    kind:               "normal",
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
    transitions: null, // エンディング扱い（遷移QR不付与）
    ...overrides,
  };
}

// ────────────────────────────────────────────
// A. 正式対応 type の正常変換
// ────────────────────────────────────────────

describe("A. 正式対応 type の正常変換", () => {

  it("text + body → text LINE メッセージ", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "t1", message_type: "text", body: "Hello!" }),
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect((result[0] as { text: string }).text).toBe("Hello!");
  });

  it("image + asset_url → image LINE メッセージ", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "i1", message_type: "image", body: null, asset_url: "https://example.com/img.jpg" }),
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("image");
  });

  it("video + asset_url → video LINE メッセージ", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "v1", message_type: "video", body: null, asset_url: "https://example.com/vid.mp4" }),
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("video");
  });
});

// ────────────────────────────────────────────
// B. フォールバック type の安全な変換
// ────────────────────────────────────────────

describe("B. フォールバック type の安全な変換", () => {

  it("carousel + alt_text → alt_text がテキスト送信される", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({
        id: "c1",
        message_type: "carousel" as RuntimePhaseMessage["message_type"],
        body: JSON.stringify([{ title: "card" }]),
        alt_text: "カルーセルの概要",
      }),
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect((result[0] as { text: string }).text).toBe("カルーセルの概要");
  });

  it("carousel + body のみ（alt_text なし）→ body がテキスト送信される", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({
        id: "c2",
        message_type: "carousel" as RuntimePhaseMessage["message_type"],
        body: "カードの説明テキスト",
        alt_text: null,
      }),
    ]));
    expect(result).toHaveLength(1);
    expect((result[0] as { text: string }).text).toBe("カードの説明テキスト");
  });

  it("voice + alt_text → テキストフォールバック送信される", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({
        id: "vo1",
        message_type: "voice" as RuntimePhaseMessage["message_type"],
        body: null,
        asset_url: "https://example.com/audio.m4a",
        alt_text: "ボイスメッセージの説明",
      }),
    ]));
    // voice は asset_url があるが、フォールバックで alt_text がテキスト送信される
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
  });

  it("riddle + body → テキストフォールバック送信される", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({
        id: "r1",
        message_type: "riddle" as RuntimePhaseMessage["message_type"],
        body: "外部参照の謎テキスト",
      }),
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect((result[0] as { text: string }).text).toBe("外部参照の謎テキスト");
  });

  it("flex + alt_text → テキストフォールバック送信される（後方互換）", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({
        id: "f1",
        message_type: "flex" as RuntimePhaseMessage["message_type"],
        body: null,
        alt_text: "Flexの代替テキスト",
      }),
    ]));
    expect(result).toHaveLength(1);
    expect((result[0] as { text: string }).text).toBe("Flexの代替テキスト");
  });

  it("未知の type + body → テキストフォールバック送信される", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({
        id: "u1",
        message_type: "unknown_future_type" as RuntimePhaseMessage["message_type"],
        body: "何かのテキスト",
      }),
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
  });
});

// ────────────────────────────────────────────
// C. 必須フィールド欠損時の安全なスキップ
// ────────────────────────────────────────────

describe("C. 必須フィールド欠損時の安全なスキップ", () => {

  it("text + body null → スキップされ warning ログが出る", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "bad-text", message_type: "text", body: null }),
    ]));
    expect(result).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("text メッセージの body が空"),
    );
  });

  it("image + asset_url null → スキップされ warning ログが出る", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "bad-img", message_type: "image", body: null, asset_url: null }),
    ]));
    expect(result).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("image メッセージの asset_url が空"),
    );
  });

  it("video + asset_url null → スキップされ warning ログが出る", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "bad-vid", message_type: "video", body: null, asset_url: null }),
    ]));
    expect(result).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("video メッセージの asset_url が空"),
    );
  });

  it("完全に空のメッセージ（body も asset も alt も null）→ スキップ + 変換不能ログ", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({
        id: "empty",
        message_type: "carousel" as RuntimePhaseMessage["message_type"],
        body: null, asset_url: null, alt_text: null,
      }),
    ]));
    expect(result).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("変換不能メッセージ"),
      expect.any(String),
      expect.any(String),
    );
  });

  it("入力2件 → 変換0件の場合に error ログが出る", () => {
    buildPhaseMessages(makePhase([
      makeMsg({ id: "b1", message_type: "text", body: null }),
      makeMsg({ id: "b2", message_type: "image", body: null, asset_url: null }),
    ]));
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("入力 2件 → LINE変換 0件"),
    );
  });

  it("入力3件中1件だけ変換不能 → 残り2件は正常送信 + warn ログ", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "ok1", message_type: "text", body: "正常1" }),
      makeMsg({ id: "bad", message_type: "text", body: null }),
      makeMsg({ id: "ok2", message_type: "text", body: "正常2" }),
    ]));
    expect(result).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("入力 3件 → LINE変換 2件"),
    );
  });
});

// ────────────────────────────────────────────
// D. puzzle メッセージの変換パイプライン
// ────────────────────────────────────────────

describe("D. puzzle メッセージの変換パイプライン", () => {

  it("text puzzle (body あり) → text LINE メッセージ", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "p1", message_type: "text", body: "この謎を解け！" }),
    ]));
    expect(result).toHaveLength(1);
    expect((result[0] as { text: string }).text).toContain("この謎を解け");
  });

  it("image puzzle → image LINE メッセージ", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "p2", message_type: "image", body: null, asset_url: "https://example.com/puzzle.jpg" }),
    ]));
    expect(result.some((m) => m.type === "image")).toBe(true);
  });

  it("carousel puzzle → フォールバック text（黙って消えない）", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({
        id: "p3",
        message_type: "carousel" as RuntimePhaseMessage["message_type"],
        body: JSON.stringify([{ title: "選択肢1" }]),
        alt_text: "カルーセルの説明",
      }),
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
  });

  it("normal text + puzzle text → 2件とも LINE メッセージになる", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "m1", message_type: "text", body: "導入" }),
      makeMsg({ id: "p1", message_type: "text", body: "謎を解け" }),
    ]));
    expect(result.filter((m) => m.type === "text")).toHaveLength(2);
  });

  it("normal text + image puzzle → text + image の 2件", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "m1", message_type: "text", body: "まず読んでね" }),
      makeMsg({ id: "p1", message_type: "image", body: null, asset_url: "https://example.com/puzzle.jpg" }),
    ]));
    expect(result.some((m) => m.type === "text")).toBe(true);
    expect(result.some((m) => m.type === "image")).toBe(true);
  });

  // ── puzzle フォールバック（body/asset_url が null でもドロップしない）──

  it("puzzle text + body=null → フォールバックテキストで送信", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "p1", kind: "puzzle", message_type: "text", body: null }),
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect((result[0] as { text: string }).text).toBe("この謎を解いてください");
  });

  it("puzzle text + body=null + alt_text あり → alt_text で送信", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "p1", kind: "puzzle", message_type: "text", body: null, alt_text: "問題のヒント画像を見てください" }),
    ]));
    expect(result).toHaveLength(1);
    expect((result[0] as { text: string }).text).toContain("問題のヒント");
  });

  it("puzzle image + asset_url=null → テキストフォールバックで送信", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "p1", kind: "puzzle", message_type: "image", body: null, asset_url: null }),
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect((result[0] as { text: string }).text).toBe("この謎を解いてください");
  });

  it("puzzle image + asset_url=null + body あり → body をテキスト送信", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "p1", kind: "puzzle", message_type: "image", body: "この画像の答えは？", asset_url: null }),
    ]));
    expect(result).toHaveLength(1);
    expect((result[0] as { text: string }).text).toContain("この画像の答えは");
  });

  it("normal text + body=null → 従来通りドロップ（puzzle 以外は変更なし）", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "m1", kind: "normal", message_type: "text", body: null }),
    ]));
    expect(result).toHaveLength(0);
  });

  it("Message → Puzzle(body=null) → 両方送信される", () => {
    const result = buildPhaseMessages(makePhase([
      makeMsg({ id: "m1", kind: "normal", message_type: "text", body: "導入テキスト" }),
      makeMsg({ id: "p1", kind: "puzzle", message_type: "text", body: null }),
    ]));
    expect(result).toHaveLength(2);
    expect((result[0] as { text: string }).text).toContain("導入テキスト");
    expect((result[1] as { text: string }).text).toBe("この謎を解いてください");
  });
});

// ────────────────────────────────────────────
// E. drainAutoSendableItems → buildPhaseMessages 統合
// ────────────────────────────────────────────

describe("E. 統合パイプライン（drain → build）", () => {

  /** DB 取得形式に近い PhaseRow message を生成する */
  function makeDbMsg(overrides: Record<string, unknown> = {}) {
    const now = new Date("2024-01-01");
    return {
      id: "db-msg", workId: "w1", phaseId: "p1", characterId: null,
      messageType: "text", body: "テスト", assetUrl: null,
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
      ...overrides,
    };
  }

  it("normal text + puzzle text → drain で 2件取得 → build で 2件の LINE メッセージ", async () => {
    const { drainAutoSendableItems } = await import("@/lib/runtime");

    const msgs = [
      makeDbMsg({ id: "m1", sortOrder: 0, body: "導入テキスト" }),
      makeDbMsg({ id: "puzzle1", sortOrder: 1, kind: "puzzle", body: "この謎を解け", answer: "42" }),
    ];

    const drained = drainAutoSendableItems(msgs as any, "in_progress");
    expect(drained).toHaveLength(2);

    const phase: RuntimePhase = {
      id: "p1", phase_type: "normal", name: "テスト", description: null,
      messages: drained, transitions: null,
    };
    const lineMessages = buildPhaseMessages(phase);
    expect(lineMessages).toHaveLength(2);
    expect((lineMessages[0] as { text: string }).text).toContain("導入テキスト");
    expect((lineMessages[1] as { text: string }).text).toContain("この謎を解け");
  });

  it("normal text + image puzzle → drain 2件 → build で text + image", async () => {
    const { drainAutoSendableItems } = await import("@/lib/runtime");

    const msgs = [
      makeDbMsg({ id: "m1", sortOrder: 0, body: "テキスト" }),
      makeDbMsg({
        id: "puzzle1", sortOrder: 1, kind: "puzzle",
        messageType: "image", body: null,
        assetUrl: "https://example.com/puzzle.jpg", answer: "答え",
      }),
    ];

    const drained = drainAutoSendableItems(msgs as any, "in_progress");
    expect(drained).toHaveLength(2);

    const lineMessages = buildPhaseMessages(makePhase(drained));
    expect(lineMessages.some((m) => m.type === "text")).toBe(true);
    expect(lineMessages.some((m) => m.type === "image")).toBe(true);
  });

  it("normal + carousel puzzle → drain 2件 → build でテキスト2件（carousel はフォールバック）", async () => {
    const { drainAutoSendableItems } = await import("@/lib/runtime");

    const msgs = [
      makeDbMsg({ id: "m1", sortOrder: 0, body: "導入" }),
      makeDbMsg({
        id: "puzzle1", sortOrder: 1, kind: "puzzle",
        messageType: "carousel", body: JSON.stringify([{ title: "card" }]),
        altText: "カルーセル謎", answer: "答え",
      }),
    ];

    const drained = drainAutoSendableItems(msgs as any, "in_progress");
    expect(drained).toHaveLength(2);

    const lineMessages = buildPhaseMessages(makePhase(drained));
    expect(lineMessages).toHaveLength(2);
    // carousel puzzle は alt_text でフォールバック
    expect((lineMessages[1] as { text: string }).text).toContain("カルーセル謎");
  });
});
