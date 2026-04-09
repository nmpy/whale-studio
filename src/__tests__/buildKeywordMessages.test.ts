/**
 * src/__tests__/buildKeywordMessages.test.ts
 *
 * buildKeywordMessages の LINE メッセージ変換を検証する。
 * buildPhaseMessages と同一の convertMessageToLine を使用しているため、
 * 変換契約の一致（parity）も検証する。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildKeywordMessages, buildPhaseMessages, type KeywordMessageRecord } from "@/lib/line";
import type { RuntimePhase, RuntimePhaseMessage } from "@/types";

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

/** テスト用 KeywordMessageRecord を生成する */
function makeKwMsg(overrides: Partial<KeywordMessageRecord> = {}): KeywordMessageRecord {
  return {
    id:              "kw-1",
    messageType:     "text",
    body:            "キーワード応答テキスト",
    assetUrl:        null,
    altText:         null,
    flexPayloadJson: null,
    quickReplies:    null,
    nextMessageId:   null,
    sortOrder:       0,
    character:       null,
    ...overrides,
  };
}

// ────────────────────────────────────────────
// A. 正式対応 type
// ────────────────────────────────────────────

describe("buildKeywordMessages — 正式対応 type", () => {

  it("text + body → text LINE メッセージ", () => {
    const result = buildKeywordMessages([makeKwMsg({ messageType: "text", body: "応答テキスト" })]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect((result[0] as { text: string }).text).toBe("応答テキスト");
  });

  it("image + assetUrl → image LINE メッセージ", () => {
    const result = buildKeywordMessages([makeKwMsg({ messageType: "image", body: null, assetUrl: "https://example.com/img.jpg" })]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("image");
  });

  it("video + assetUrl → video LINE メッセージ", () => {
    const result = buildKeywordMessages([makeKwMsg({ messageType: "video", body: null, assetUrl: "https://example.com/vid.mp4" })]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("video");
  });
});

// ────────────────────────────────────────────
// B. フォールバック type
// ────────────────────────────────────────────

describe("buildKeywordMessages — フォールバック type", () => {

  it("carousel + altText → text フォールバック", () => {
    const result = buildKeywordMessages([makeKwMsg({ messageType: "carousel", body: "[{\"t\":1}]", altText: "カルーセル概要" })]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
    expect((result[0] as { text: string }).text).toBe("カルーセル概要");
  });

  it("voice + altText → text フォールバック", () => {
    const result = buildKeywordMessages([makeKwMsg({ messageType: "voice", body: null, assetUrl: "https://example.com/a.m4a", altText: "ボイス説明" })]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
  });

  it("riddle + body → text フォールバック", () => {
    const result = buildKeywordMessages([makeKwMsg({ messageType: "riddle", body: "外部謎テキスト" })]);
    expect(result).toHaveLength(1);
    expect((result[0] as { text: string }).text).toBe("外部謎テキスト");
  });

  it("flex + altText → text フォールバック", () => {
    const result = buildKeywordMessages([makeKwMsg({ messageType: "flex", body: null, altText: "Flex代替" })]);
    expect(result).toHaveLength(1);
    expect((result[0] as { text: string }).text).toBe("Flex代替");
  });

  it("未知型 + body → text フォールバック", () => {
    const result = buildKeywordMessages([makeKwMsg({ messageType: "future_type", body: "何かのテキスト" })]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
  });
});

// ────────────────────────────────────────────
// C. 欠損時の安全なスキップ
// ────────────────────────────────────────────

describe("buildKeywordMessages — 欠損時の安全なスキップ", () => {

  it("text + body null → warn + skip", () => {
    const result = buildKeywordMessages([makeKwMsg({ id: "bad", messageType: "text", body: null })]);
    expect(result).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("text メッセージの body が空"));
  });

  it("image + assetUrl null → warn + skip", () => {
    const result = buildKeywordMessages([makeKwMsg({ id: "bad", messageType: "image", body: null, assetUrl: null })]);
    expect(result).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("image メッセージの asset_url が空"));
  });

  it("video + assetUrl null → warn + skip", () => {
    const result = buildKeywordMessages([makeKwMsg({ id: "bad", messageType: "video", body: null, assetUrl: null })]);
    expect(result).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("video メッセージの asset_url が空"));
  });

  it("全 null → 変換不能 warn + skip", () => {
    const result = buildKeywordMessages([makeKwMsg({ messageType: "carousel", body: null, assetUrl: null, altText: null })]);
    expect(result).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("変換不能メッセージ"), expect.any(String), expect.any(String));
  });

  it("入力2件 → 出力0件 → error ログ", () => {
    buildKeywordMessages([
      makeKwMsg({ id: "b1", messageType: "text", body: null }),
      makeKwMsg({ id: "b2", messageType: "image", body: null, assetUrl: null }),
    ]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("入力 2件 → LINE変換 0件"));
  });

  it("入力3件中1件欠損 → 残り2件送信 + warn", () => {
    const result = buildKeywordMessages([
      makeKwMsg({ id: "ok1", body: "正常1" }),
      makeKwMsg({ id: "bad", messageType: "text", body: null }),
      makeKwMsg({ id: "ok2", body: "正常2" }),
    ]);
    expect(result).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("入力 3件 → LINE変換 2件"));
  });
});

// ────────────────────────────────────────────
// D. buildPhaseMessages との変換 parity
// ────────────────────────────────────────────

describe("変換 parity: buildKeywordMessages と buildPhaseMessages で同一ルール", () => {

  /** buildPhaseMessages 用の RuntimePhaseMessage を生成する */
  function makePhaseMsg(overrides: Partial<RuntimePhaseMessage> = {}): RuntimePhaseMessage {
    return {
      id: "pm-1", kind: "normal", message_type: "text", body: "テスト", asset_url: null,
      alt_text: null, flex_payload_json: null, quick_replies: null, lag_ms: 0,
      hint_mode: "always", sort_order: 0, timing: null,
      tap_destination_id: null, tap_url: null, character: null,
      ...overrides,
    };
  }
  function makePhase(msgs: RuntimePhaseMessage[]): RuntimePhase {
    return { id: "p1", phase_type: "normal", name: "t", description: null, messages: msgs, transitions: null };
  }

  const testCases: { label: string; kwOverrides: Partial<KeywordMessageRecord>; phaseOverrides: Partial<RuntimePhaseMessage>; expectType: string | null }[] = [
    { label: "text+body",       kwOverrides: { messageType: "text", body: "hello" },                                              phaseOverrides: { message_type: "text", body: "hello" },                                              expectType: "text" },
    { label: "image+asset",     kwOverrides: { messageType: "image", body: null, assetUrl: "https://x.com/i.jpg" },               phaseOverrides: { message_type: "image", body: null, asset_url: "https://x.com/i.jpg" },               expectType: "image" },
    { label: "video+asset",     kwOverrides: { messageType: "video", body: null, assetUrl: "https://x.com/v.mp4" },               phaseOverrides: { message_type: "video", body: null, asset_url: "https://x.com/v.mp4" },               expectType: "video" },
    { label: "carousel+alt",    kwOverrides: { messageType: "carousel", body: "[{}]", altText: "fallback" },                       phaseOverrides: { message_type: "carousel" as any, body: "[{}]", alt_text: "fallback" },                expectType: "text" },
    { label: "riddle+body",     kwOverrides: { messageType: "riddle", body: "riddle text" },                                       phaseOverrides: { message_type: "riddle" as any, body: "riddle text" },                                expectType: "text" },
    { label: "text+null body",  kwOverrides: { messageType: "text", body: null },                                                  phaseOverrides: { message_type: "text", body: null },                                                  expectType: null },
    { label: "image+null asset", kwOverrides: { messageType: "image", body: null, assetUrl: null },                                phaseOverrides: { message_type: "image", body: null, asset_url: null },                                expectType: null },
  ];

  for (const tc of testCases) {
    it(`${tc.label}: keyword と phase で同じ結果 (${tc.expectType ?? "skip"})`, () => {
      const kwResult = buildKeywordMessages([makeKwMsg(tc.kwOverrides)]);
      const phResult = buildPhaseMessages(makePhase([makePhaseMsg(tc.phaseOverrides)]));

      if (tc.expectType === null) {
        expect(kwResult).toHaveLength(0);
        expect(phResult).toHaveLength(0);
      } else {
        expect(kwResult).toHaveLength(1);
        expect(phResult).toHaveLength(1);
        expect(kwResult[0].type).toBe(tc.expectType);
        expect(phResult[0].type).toBe(tc.expectType);
      }
    });
  }
});
