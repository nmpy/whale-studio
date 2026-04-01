/**
 * src/__tests__/line-quickReply-image.test.ts
 *
 * 画像 / 動画 / Flex メッセージに quickReply が正しく付与されることを検証
 *
 * 検証シナリオ:
 *  1. buildPhaseMessages: 画像メッセージの個別 quickReplies が payload に含まれる
 *  2. buildPhaseMessages: 遷移 quickReply が最後の画像メッセージに付与される（テキストなし）
 *  3. buildPhaseMessages: 遷移 quickReply が最後の画像メッセージに付与される（画像→テキストの並び）
 *  4. buildKeywordMessages: 画像メッセージの quickReplies が payload に含まれる
 *  5. buildKeywordMessages: 動画メッセージの quickReplies が payload に含まれる
 *  6. buildKeywordMessages: Flex メッセージの quickReplies が payload に含まれる
 */

import { describe, it, expect } from "vitest";
import { buildPhaseMessages, buildKeywordMessages } from "@/lib/line";
import type { RuntimePhase } from "@/types";
import type { KeywordMessageRecord } from "@/lib/line";

// ────────────────────────────────────────────────
//  ヘルパー
// ────────────────────────────────────────────────

const QR_ITEMS_JSON = JSON.stringify([
  { label: "次へ", action: "message", value: "次へ" },
]);

function makePhase(overrides: Partial<RuntimePhase>): RuntimePhase {
  return {
    id:           "phase-1",
    phase_type:   "normal",
    name:         "テスト",
    description:  null,
    messages:     [],
    transitions:  [],
    ...overrides,
  };
}

// ────────────────────────────────────────────────
//  1. buildPhaseMessages: 画像メッセージの個別 quickReply
// ────────────────────────────────────────────────

describe("buildPhaseMessages — 個別 quickReply", () => {
  it("画像メッセージの quick_replies が LINE quickReply に変換される", () => {
    const phase = makePhase({
      messages: [{
        id:                "msg-1",
        message_type:      "image",
        body:              null,
        asset_url:         "https://example.com/puzzle.png",
        alt_text:          null,
        flex_payload_json: null,
        quick_replies:     [{ label: "次へ", action: "message", value: "次へ" }],
        sort_order:        0,
        character:         null,
      }],
      transitions: [], // 遷移なし → QRなし（個別 QR のみテスト）
    });

    const msgs = buildPhaseMessages(phase, {});

    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe("image");
    const img = msgs[0] as { type: string; quickReply?: { items: unknown[] } };
    expect(img.quickReply).toBeDefined();
    expect(img.quickReply!.items).toHaveLength(1);
    expect((img.quickReply!.items[0] as { action: { label: string } }).action.label).toBe("次へ");
  });

  it("動画メッセージの quick_replies が LINE quickReply に変換される", () => {
    const phase = makePhase({
      messages: [{
        id:                "msg-v",
        message_type:      "video",
        body:              null,
        asset_url:         "https://example.com/video.mp4",
        alt_text:          null,
        flex_payload_json: null,
        quick_replies:     [{ label: "続ける", action: "message", value: "続ける" }],
        sort_order:        0,
        character:         null,
      }],
      transitions: [],
    });

    const msgs = buildPhaseMessages(phase, {});
    expect(msgs[0].type).toBe("video");
    const vid = msgs[0] as { type: string; quickReply?: { items: unknown[] } };
    expect(vid.quickReply).toBeDefined();
    expect(vid.quickReply!.items).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────
//  2. buildPhaseMessages: 遷移 quickReply が画像に付与される
// ────────────────────────────────────────────────

describe("buildPhaseMessages — 遷移 quickReply", () => {
  it("最後のメッセージが画像でも遷移 quickReply が付与される", () => {
    const phase = makePhase({
      messages: [{
        id:                "msg-img",
        message_type:      "image",
        body:              null,
        asset_url:         "https://example.com/img.png",
        alt_text:          null,
        flex_payload_json: null,
        quick_replies:     null,
        sort_order:        0,
        character:         null,
      }],
      transitions: [
        { id: "t1", label: "先へ進む", to_phase: { id: "p2", name: "次のフェーズ", phase_type: "normal" }, condition: null, sort_order: 0 },
      ],
    });

    const msgs = buildPhaseMessages(phase, {});

    // 画像のみ: 遷移 QR が画像に付与されるので追加のテキストメッセージは不要
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe("image");
    const img = msgs[0] as { quickReply?: { items: { action: { label?: string } }[] } };
    expect(img.quickReply).toBeDefined();
    expect(img.quickReply!.items[0].action.label).toBe("先へ進む");
  });

  it("テキスト→画像の並びで遷移 quickReply が最後の画像に付与される", () => {
    const phase = makePhase({
      messages: [
        {
          id: "msg-txt", message_type: "text", body: "本文です",
          asset_url: null, alt_text: null, flex_payload_json: null,
          quick_replies: null, sort_order: 0, character: null,
        },
        {
          id: "msg-img", message_type: "image", body: null,
          asset_url: "https://example.com/img.png", alt_text: null, flex_payload_json: null,
          quick_replies: null, sort_order: 1, character: null,
        },
      ],
      transitions: [
        { id: "t1", label: "次へ", to_phase: { id: "p2", name: "次", phase_type: "normal" }, condition: null, sort_order: 0 },
      ],
    });

    const msgs = buildPhaseMessages(phase, {});

    // テキストと画像の2件。遷移QRは後ろから探して最初に見つけた（画像）に付与
    expect(msgs).toHaveLength(2);
    const lastMsg = msgs[1] as { type: string; quickReply?: unknown };
    expect(lastMsg.type).toBe("image");
    expect(lastMsg.quickReply).toBeDefined();
    // テキストには遷移 QR が付与されていないこと
    const firstMsg = msgs[0] as { type: string; quickReply?: unknown };
    expect(firstMsg.quickReply).toBeUndefined();
  });

  it("全メッセージに個別 quickReply 設定済みの場合は「続きを選んでください」テキストを追加", () => {
    const phase = makePhase({
      messages: [{
        id: "msg-img", message_type: "image", body: null,
        asset_url: "https://example.com/img.png", alt_text: null, flex_payload_json: null,
        quick_replies: [{ label: "はい", action: "message", value: "はい" }], // 個別 QR あり
        sort_order: 0, character: null,
      }],
      transitions: [
        { id: "t1", label: "次へ", to_phase: { id: "p2", name: "次", phase_type: "normal" }, condition: null, sort_order: 0 },
      ],
    });

    const msgs = buildPhaseMessages(phase, {});

    // 画像に個別 QR 設定済み → 遷移 QR を付与するメッセージなし → システムナビ追加
    expect(msgs).toHaveLength(2);
    expect(msgs[1].type).toBe("text");
    const nav = msgs[1] as { type: string; quickReply?: { items: { action: { label?: string } }[] } };
    expect(nav.quickReply).toBeDefined();
    expect(nav.quickReply!.items[0].action.label).toBe("次へ");
  });
});

// ────────────────────────────────────────────────
//  3. buildKeywordMessages — 各型の quickReply
// ────────────────────────────────────────────────

describe("buildKeywordMessages — quickReply", () => {
  function makeRecord(overrides: Partial<KeywordMessageRecord & { triggerKeyword: string }>): KeywordMessageRecord & { triggerKeyword: string } {
    return {
      id:              "msg-kw",
      triggerKeyword:  "test",
      messageType:     "text",
      body:            "test",
      assetUrl:        null,
      altText:         null,
      flexPayloadJson: null,
      quickReplies:    null,
      sortOrder:       0,
      character:       null,
      ...overrides,
    };
  }

  it("画像メッセージの quickReplies が LINE quickReply に変換される", () => {
    const records = [makeRecord({
      messageType:  "image",
      body:         null,
      assetUrl:     "https://example.com/img.png",
      quickReplies: QR_ITEMS_JSON,
    })];

    const msgs = buildKeywordMessages(records);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe("image");
    const img = msgs[0] as { quickReply?: { items: unknown[] } };
    expect(img.quickReply).toBeDefined();
    expect(img.quickReply!.items).toHaveLength(1);
  });

  it("動画メッセージの quickReplies が LINE quickReply に変換される", () => {
    const records = [makeRecord({
      messageType:  "video",
      body:         null,
      assetUrl:     "https://example.com/video.mp4",
      quickReplies: QR_ITEMS_JSON,
    })];

    const msgs = buildKeywordMessages(records);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe("video");
    const vid = msgs[0] as { quickReply?: { items: unknown[] } };
    expect(vid.quickReply).toBeDefined();
  });

  it("Flex メッセージの quickReplies が LINE quickReply に変換される", () => {
    const flexJson = JSON.stringify({ type: "bubble", body: { type: "box", layout: "vertical", contents: [] } });
    const records = [makeRecord({
      messageType:     "flex",
      body:            null,
      altText:         "Flex テスト",
      flexPayloadJson: flexJson,
      quickReplies:    QR_ITEMS_JSON,
    })];

    const msgs = buildKeywordMessages(records);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe("flex");
    const flex = msgs[0] as { quickReply?: { items: unknown[] } };
    expect(flex.quickReply).toBeDefined();
    expect(flex.quickReply!.items).toHaveLength(1);
  });

  it("quickReplies が null の場合は quickReply が付与されない", () => {
    const records = [makeRecord({
      messageType:  "image",
      body:         null,
      assetUrl:     "https://example.com/img.png",
      quickReplies: null,
    })];

    const msgs = buildKeywordMessages(records);
    expect(msgs[0].type).toBe("image");
    const img = msgs[0] as { quickReply?: unknown };
    expect(img.quickReply).toBeUndefined();
  });
});
