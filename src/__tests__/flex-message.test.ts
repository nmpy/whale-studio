// src/__tests__/flex-message.test.ts
//
// Flex Message: JSON 正規化・検証 (lib/flex) と、LINE 送信 payload 変換 (buildKeywordMessages)。

import { describe, it, expect } from "vitest";
import {
  normalizeFlexJson,
  buildFlexSendParts,
  prettyFlexJson,
  resolveFlexAltText,
  FLEX_ERRORS,
  FLEX_DEFAULT_ALT_TEXT,
} from "@/lib/flex";
import { buildKeywordMessages, type KeywordMessageRecord } from "@/lib/line";
import {
  msgToAdditionalSlot,
  additionalSlotToMsgBody,
  EMPTY_ADDITIONAL_SLOT,
} from "@/app/oas/[id]/works/[workId]/messages/_form-helpers";

const BUBBLE = '{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[{"type":"text","text":"Hello"}]}}';
const CAROUSEL = '{"type":"carousel","contents":[{"type":"bubble"}]}';
const FULL_FLEX = `{"type":"flex","altText":"全体テキスト","contents":${BUBBLE}}`;

function flexRecord(over: Partial<KeywordMessageRecord> = {}): KeywordMessageRecord {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    messageType: "flex",
    body: null,
    assetUrl: null,
    altText: "代替テキスト",
    flexPayloadJson: BUBBLE,
    quickReplies: null,
    nextMessageId: null,
    sortOrder: 0,
    character: null,
    ...over,
  };
}

describe("normalizeFlexJson（貼り付け JSON の受け入れ）", () => {
  it("パターンA: contents だけの bubble → ok / contents=bubble", () => {
    const r = normalizeFlexJson(BUBBLE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.contents.type).toBe("bubble");
      expect(r.value.altTextFromJson).toBeNull();
    }
  });

  it("パターンA: contents だけの carousel → ok / contents=carousel", () => {
    const r = normalizeFlexJson(CAROUSEL);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.contents.type).toBe("carousel");
  });

  it("パターンB: flex 全体 → contents を抽出し altText も取り出す", () => {
    const r = normalizeFlexJson(FULL_FLEX);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.contents.type).toBe("bubble");
      expect(r.value.altTextFromJson).toBe("全体テキスト");
    }
  });

  it("不正な JSON → invalidJson エラー", () => {
    const r = normalizeFlexJson("{ not json ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(FLEX_ERRORS.invalidJson);
  });

  it("type が bubble/carousel 以外 → badType エラー", () => {
    const r = normalizeFlexJson('{"type":"box","layout":"vertical"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(FLEX_ERRORS.badType);
  });

  it("flex 全体だが contents.type が不正 → badType エラー", () => {
    const r = normalizeFlexJson('{"type":"flex","altText":"x","contents":{"type":"box"}}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(FLEX_ERRORS.badType);
  });

  it("空文字 / null → invalidJson エラー", () => {
    expect(normalizeFlexJson("").ok).toBe(false);
    expect(normalizeFlexJson(null).ok).toBe(false);
    expect(normalizeFlexJson(undefined).ok).toBe(false);
  });

  it("配列はコンテナとして不正 → badType", () => {
    const r = normalizeFlexJson("[]");
    expect(r.ok).toBe(false);
  });
});

describe("resolveFlexAltText / prettyFlexJson", () => {
  it("フォーム値を優先、無ければ JSON 内 altText、無ければ null", () => {
    expect(resolveFlexAltText("フォーム", "json")).toBe("フォーム");
    expect(resolveFlexAltText("  ", "json")).toBe("json");
    expect(resolveFlexAltText("", null)).toBeNull();
  });
  it("最大 400 文字に丸める", () => {
    expect(resolveFlexAltText("あ".repeat(500))!.length).toBe(400);
  });
  it("prettyFlexJson は整形、不正時は原文を返す", () => {
    expect(prettyFlexJson(BUBBLE)).toContain("\n");
    expect(prettyFlexJson("{bad")).toBe("{bad");
  });
});

describe("buildFlexSendParts（送信 parts 組み立て）", () => {
  it("contents + altText を返す", () => {
    const parts = buildFlexSendParts(BUBBLE, "代替");
    expect(parts).not.toBeNull();
    expect(parts!.altText).toBe("代替");
    expect(parts!.contents.type).toBe("bubble");
  });
  it("altText 空 + 全体 JSON → JSON 内 altText を使う", () => {
    const parts = buildFlexSendParts(FULL_FLEX, "");
    expect(parts!.altText).toBe("全体テキスト");
  });
  it("altText も JSON altText も無ければデフォルト", () => {
    const parts = buildFlexSendParts(BUBBLE, "");
    expect(parts!.altText).toBe(FLEX_DEFAULT_ALT_TEXT);
  });
  it("不正 JSON → null", () => {
    expect(buildFlexSendParts("{bad", "x")).toBeNull();
  });
});

describe("buildKeywordMessages（LINE 送信 payload 変換）", () => {
  it("flex record → { type:'flex', altText, contents }", () => {
    const out = buildKeywordMessages([flexRecord()]);
    expect(out).toHaveLength(1);
    const m = out[0] as { type: string; altText: string; contents: { type: string } };
    expect(m.type).toBe("flex");
    expect(m.altText).toBe("代替テキスト");
    expect(m.contents.type).toBe("bubble");
  });

  it("flex record (carousel contents) も送信できる", () => {
    const out = buildKeywordMessages([flexRecord({ flexPayloadJson: CAROUSEL })]);
    const m = out[0] as { type: string; contents: { type: string } };
    expect(m.type).toBe("flex");
    expect(m.contents.type).toBe("carousel");
  });

  it("flex の altText が空でも JSON 全体貼り付けなら altText を補完する", () => {
    const out = buildKeywordMessages([flexRecord({ altText: null, flexPayloadJson: FULL_FLEX })]);
    const m = out[0] as { type: string; altText: string };
    expect(m.type).toBe("flex");
    expect(m.altText).toBe("全体テキスト");
  });

  it("flex payload が不正なら altText テキストにフォールバック（送信ゼロにしない）", () => {
    const out = buildKeywordMessages([flexRecord({ flexPayloadJson: "{bad", altText: "フォールバック" })]);
    const m = out[0] as { type: string; text?: string };
    expect(m.type).toBe("text");
    expect(m.text).toBe("フォールバック");
  });

  it("regression: text record は従来どおり { type:'text', text }", () => {
    const out = buildKeywordMessages([
      flexRecord({ messageType: "text", body: "こんにちは", flexPayloadJson: null, altText: null }),
    ]);
    const m = out[0] as { type: string; text: string };
    expect(m.type).toBe("text");
    expect(m.text).toBe("こんにちは");
  });

  it("regression: image record は従来どおり image/flex(画像アクション) を返す", () => {
    const out = buildKeywordMessages([
      flexRecord({ messageType: "image", assetUrl: "https://example.com/a.png", flexPayloadJson: null, altText: null }),
    ]);
    const m = out[0] as { type: string };
    // 画像タップアクション無し → image message
    expect(m.type).toBe("image");
  });
});

describe("チェーン (2通目以降) の Flex 保存・復元", () => {
  const mainCtx = {
    work_id: "w1", phase_id: "p1", character_id: null,
    kind: "normal" as const, sort_order: 1, is_active: true,
  };

  it("additionalSlotToMsgBody: flex slot → contents 正規化 + altText を body に載せる", () => {
    const body = additionalSlotToMsgBody(
      { ...EMPTY_ADDITIONAL_SLOT, message_type: "flex", alt_text: "代替", flex_payload_json: BUBBLE },
      mainCtx,
    );
    expect(body.message_type).toBe("flex");
    expect(body.alt_text).toBe("代替");
    expect(JSON.parse(body.flex_payload_json!).type).toBe("bubble");
    // flex は body/asset_url を持たない
    expect(body.body).toBeUndefined();
    expect(body.asset_url).toBeUndefined();
  });

  it("additionalSlotToMsgBody: 全体 flex JSON を貼っても contents に正規化", () => {
    const body = additionalSlotToMsgBody(
      { ...EMPTY_ADDITIONAL_SLOT, message_type: "flex", alt_text: "代替", flex_payload_json: FULL_FLEX },
      mainCtx,
    );
    expect(JSON.parse(body.flex_payload_json!).type).toBe("bubble");
  });

  it("additionalSlotToMsgBody: text slot は flex フィールドを持たない (regression)", () => {
    const body = additionalSlotToMsgBody(
      { ...EMPTY_ADDITIONAL_SLOT, message_type: "text", body: "やあ" },
      mainCtx,
    );
    expect(body.message_type).toBe("text");
    expect(body.alt_text).toBeNull();
    expect(body.flex_payload_json).toBeNull();
    expect(body.body).toBe("やあ");
  });

  it("msgToAdditionalSlot: flex メッセージを編集スロットへ復元（altText + 整形 JSON）", () => {
    const slot = msgToAdditionalSlot({
      id: "m1", message_type: "flex", alt_text: "代替", flex_payload_json: BUBBLE,
    });
    expect(slot.message_type).toBe("flex");
    expect(slot.alt_text).toBe("代替");
    expect(slot.flex_payload_json).toContain("\n"); // pretty 整形済み
    expect(JSON.parse(slot.flex_payload_json).type).toBe("bubble");
  });
});
