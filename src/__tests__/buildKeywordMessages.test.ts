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

  it("video + assetUrl + サムネ → video LINE メッセージ（previewImageUrl はサムネ・mp4 を流用しない）", () => {
    const result = buildKeywordMessages([makeKwMsg({ messageType: "video", body: null, assetUrl: "https://example.com/vid.mp4", assetPreviewUrl: "https://example.com/thumb.jpg" })]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("video");
    const vid = result[0] as { originalContentUrl: string; previewImageUrl: string };
    expect(vid.originalContentUrl).toBe("https://example.com/vid.mp4");
    expect(vid.previewImageUrl).toBe("https://example.com/thumb.jpg");
  });

  it("video + assetUrl(Cloudinary) + サムネ未設定 → video LINE メッセージ（previewImageUrl は生成画像・mp4流用しない）", () => {
    const mp4 = "https://res.cloudinary.com/duvd61vx6/video/upload/v1/vid.mp4";
    const result = buildKeywordMessages([makeKwMsg({ messageType: "video", body: null, assetUrl: mp4 })]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("video");
    const vid = result[0] as { originalContentUrl: string; previewImageUrl: string };
    expect(vid.originalContentUrl).toBe(mp4);
    // サムネ未設定でも URLテキストに落とさず video を維持。previewImageUrl は生成した画像URL(mp4でない)
    expect(vid.previewImageUrl).not.toBe(mp4);
    expect(vid.previewImageUrl.endsWith(".jpg")).toBe(true);
  });

  it("video + assetUsage=liff_playback → LINE video 送信せずリンク誘導テキスト", () => {
    const result = buildKeywordMessages([makeKwMsg({ messageType: "video", body: null, assetUrl: "https://example.com/big.mp4", assetPreviewUrl: "https://example.com/thumb.jpg", assetUsage: "liff_playback" })]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
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
    // carousel（カード0/本文なし）→ Flex 化不能・alt_text/body も無いため送信なし（ログは出る）。
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("carousel が空"));
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
      tap_destination_id: null, tap_url: null,
      image_action_type: null, image_action_text: null, image_action_url: null,
      image_action_liff_page_id: null, image_action_postback_data: null,
      character: null,
      ...overrides,
    };
  }
  function makePhase(msgs: RuntimePhaseMessage[]): RuntimePhase {
    return { id: "p1", phase_type: "normal", name: "t", description: null, messages: msgs, transitions: null };
  }

  const testCases: { label: string; kwOverrides: Partial<KeywordMessageRecord>; phaseOverrides: Partial<RuntimePhaseMessage>; expectType: string | null }[] = [
    { label: "text+body",       kwOverrides: { messageType: "text", body: "hello" },                                              phaseOverrides: { message_type: "text", body: "hello" },                                              expectType: "text" },
    { label: "image+asset",     kwOverrides: { messageType: "image", body: null, assetUrl: "https://x.com/i.jpg" },               phaseOverrides: { message_type: "image", body: null, asset_url: "https://x.com/i.jpg" },               expectType: "image" },
    { label: "video+asset",     kwOverrides: { messageType: "video", body: null, assetUrl: "https://x.com/v.mp4", assetPreviewUrl: "https://x.com/t.jpg" }, phaseOverrides: { message_type: "video", body: null, asset_url: "https://x.com/v.mp4", asset_preview_url: "https://x.com/t.jpg" }, expectType: "video" },
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

// ── 通話リクエスト（message_type="call_request"）──
describe("call_request: 通話リクエストは uri ボタン付き Flex として送信される", () => {
  const cfg = {
    title: "通話リクエスト",
    body: "必要に応じて、下のボタンから通話を開始してください。",
    buttonLabel: "電話をかける",
    callType: "tel",
    tel: "03-1234-5678",
    supplement: "",
  };

  it("tel: Flex の footer ボタン uri が tel: 形式になる", () => {
    const out = buildKeywordMessages([makeKwMsg({ messageType: "call_request", flexPayloadJson: JSON.stringify(cfg) })]);
    expect(out).toHaveLength(1);
    const msg = out[0] as { type: string; altText?: string; contents?: Record<string, unknown> };
    expect(msg.type).toBe("flex");
    const footer = msg.contents?.footer as { contents?: { action?: { type?: string; uri?: string; label?: string } }[] };
    const action = footer?.contents?.[0]?.action;
    expect(action?.type).toBe("uri");
    expect(action?.uri).toBe("tel:0312345678");
    expect(action?.label).toBe("電話をかける");
  });

  it("line_call_url / url: button uri に入力URLが入る", () => {
    const line = buildKeywordMessages([makeKwMsg({ messageType: "call_request", flexPayloadJson: JSON.stringify({ ...cfg, callType: "line_call_url", lineCallUrl: "https://line.me/call/abc" }) })]);
    const lineFooter = (line[0] as { contents?: Record<string, unknown> }).contents?.footer as { contents?: { action?: { uri?: string } }[] };
    expect(lineFooter?.contents?.[0]?.action?.uri).toBe("https://line.me/call/abc");
    const url = buildKeywordMessages([makeKwMsg({ messageType: "call_request", flexPayloadJson: JSON.stringify({ ...cfg, callType: "url", url: "https://example.com/x" }) })]);
    const urlFooter = (url[0] as { contents?: Record<string, unknown> }).contents?.footer as { contents?: { action?: { uri?: string } }[] };
    expect(urlFooter?.contents?.[0]?.action?.uri).toBe("https://example.com/x");
  });

  it("設定不正はテキストフォールバック（送信ゼロを避ける）", () => {
    const out = buildKeywordMessages([makeKwMsg({ messageType: "call_request", flexPayloadJson: JSON.stringify({ ...cfg, callType: "tel", tel: "" }), altText: "通話リクエスト", body: "fallback" })]);
    // uri 生成不可 → text フォールバック
    expect((out[0] as { type: string }).type).toBe("text");
  });
});

// ────────────────────────────────────────────
// G. キーワード応答: 末尾メッセージの quickReply が LINE payload に付く
//    （実機で「分かった」QR が出ない事象の回帰固定。CMS プレビューと実送信の一致）
// ────────────────────────────────────────────
describe("G. keyword 応答チェーン末尾の quickReply 付与", () => {
  it("末尾メッセージに response_message_id 付き QR「分かった」→ 最終 LINE メッセージに postback quickReply が付く", () => {
    const qr = JSON.stringify([{ label: "分かった", action: "text", response_message_id: "cr-id", enabled: true }]);
    const out = buildKeywordMessages([
      makeKwMsg({ id: "r1", body: "応答1", nextMessageId: "r2" }),
      makeKwMsg({ id: "r2", body: "応答2(末尾)", quickReplies: qr }),
    ]);
    expect(out).toHaveLength(2);
    const last = out[out.length - 1] as { quickReply?: { items: { action: { type: string; label: string } }[] } };
    expect(last.quickReply).toBeDefined();
    expect(last.quickReply!.items).toHaveLength(1);
    // response_message_id を持つため postback 化される（deliverQrBranch で解決）
    expect(last.quickReply!.items[0].action.type).toBe("postback");
    expect(last.quickReply!.items[0].action.label).toBe("分かった");
  });

  it("QR が中間メッセージにあっても moveQuickReplyToTail で最終メッセージへ集約される", () => {
    const qr = JSON.stringify([{ label: "分かった", action: "text", value: "分かった", enabled: true }]);
    const out = buildKeywordMessages([
      makeKwMsg({ id: "r1", body: "応答1(QR)", quickReplies: qr, nextMessageId: "r2" }),
      makeKwMsg({ id: "r2", body: "応答2(末尾)" }),
    ]);
    const last = out[out.length - 1] as { quickReply?: unknown };
    const mid  = out[0] as { quickReply?: unknown };
    expect(last.quickReply).toBeDefined();  // 末尾へ集約
    expect(mid.quickReply).toBeUndefined(); // 中間からは除去
  });

  it("enabled=false の QR item は実送信で drop（プレビューも同条件で除外し一致させる）", () => {
    const qr = JSON.stringify([{ label: "分かった", action: "text", response_message_id: "cr-id", enabled: false }]);
    const out = buildKeywordMessages([makeKwMsg({ id: "r1", body: "応答", quickReplies: qr })]);
    const last = out[out.length - 1] as { quickReply?: unknown };
    expect(last.quickReply).toBeUndefined(); // enabled=false → quickReply なし
  });
});
