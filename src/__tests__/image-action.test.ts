// src/__tests__/image-action.test.ts
//
// 画像メッセージのタップ時アクション機能の単体テスト。
// - buildImageActionFlex (LINE payload 生成) の挙動
// - createMessageSchema / updateMessageSchema の image_action_* バリデーション

import { describe, it, expect } from "vitest";
import { buildImageActionFlex } from "@/lib/line";
import { createMessageSchema, updateMessageSchema } from "@/lib/validations";

const HTTPS_IMG = "https://example.com/img.png";

describe("buildImageActionFlex()", () => {
  it("imageAction が null なら null を返す (= 通常の Image Message に戻す)", () => {
    expect(buildImageActionFlex({
      imageUrl: HTTPS_IMG, altText: null, imageAction: null,
    })).toBeNull();
  });

  it('type="none" なら null を返す', () => {
    expect(buildImageActionFlex({
      imageUrl: HTTPS_IMG, altText: null,
      imageAction: { type: "none", text: null, url: null, liffPageId: null, postbackData: null },
    })).toBeNull();
  });

  it("http:// の URL は HTTPS 必須で reject", () => {
    expect(buildImageActionFlex({
      imageUrl: "http://example.com/img.png", altText: null,
      imageAction: { type: "message", text: "x", url: null, liffPageId: null, postbackData: null },
    })).toBeNull();
  });

  it('type="message" + text 指定で Flex bubble が組み上がる', () => {
    const flex = buildImageActionFlex({
      imageUrl: HTTPS_IMG, altText: null,
      imageAction: { type: "message", text: "古い写真を見る", url: null, liffPageId: null, postbackData: null },
    });
    expect(flex).not.toBeNull();
    expect(flex!.type).toBe("flex");
    expect(flex!.altText).toBe("画像メッセージ"); // デフォルト altText
    expect(flex!.contents.type).toBe("bubble");
    expect(flex!.contents.hero.type).toBe("image");
    expect(flex!.contents.hero.url).toBe(HTTPS_IMG);
    expect(flex!.contents.hero.size).toBe("full");
    expect(flex!.contents.hero.aspectRatio).toBe("20:13");
    expect(flex!.contents.hero.aspectMode).toBe("cover");
    expect(flex!.contents.hero.action).toEqual({
      type:  "message",
      label: "古い写真を見る",
      text:  "古い写真を見る",
    });
  });

  it('type="message" の text が空なら null', () => {
    expect(buildImageActionFlex({
      imageUrl: HTTPS_IMG, altText: null,
      imageAction: { type: "message", text: "", url: null, liffPageId: null, postbackData: null },
    })).toBeNull();
    expect(buildImageActionFlex({
      imageUrl: HTTPS_IMG, altText: null,
      imageAction: { type: "message", text: null, url: null, liffPageId: null, postbackData: null },
    })).toBeNull();
  });

  it("altText 指定があればそれを使う", () => {
    const flex = buildImageActionFlex({
      imageUrl: HTTPS_IMG, altText: "古い写真のヒント",
      imageAction: { type: "message", text: "見る", url: null, liffPageId: null, postbackData: null },
    });
    expect(flex!.altText).toBe("古い写真のヒント");
  });

  it("altText が空文字 / 空白のみならデフォルトに戻る", () => {
    const flex1 = buildImageActionFlex({
      imageUrl: HTTPS_IMG, altText: "",
      imageAction: { type: "message", text: "見る", url: null, liffPageId: null, postbackData: null },
    });
    expect(flex1!.altText).toBe("画像メッセージ");
    const flex2 = buildImageActionFlex({
      imageUrl: HTTPS_IMG, altText: "   ",
      imageAction: { type: "message", text: "見る", url: null, liffPageId: null, postbackData: null },
    });
    expect(flex2!.altText).toBe("画像メッセージ");
  });

  it("label は 20 文字、text は 300 文字でカットされる", () => {
    const longText = "あ".repeat(500);
    const flex = buildImageActionFlex({
      imageUrl: HTTPS_IMG, altText: null,
      imageAction: { type: "message", text: longText, url: null, liffPageId: null, postbackData: null },
    });
    const action = flex!.contents.hero.action!;
    expect(action.type).toBe("message");
    if (action.type === "message") {
      expect(action.label!.length).toBe(20);
      expect(action.text.length).toBe(300);
    }
  });

  it('type="uri" + HTTPS URL で uri action が組み立つ', () => {
    const flex = buildImageActionFlex({
      imageUrl: HTTPS_IMG, altText: null,
      imageAction: { type: "uri", text: null, url: "https://example.com/foo", liffPageId: null, postbackData: null },
    });
    expect(flex!.contents.hero.action).toEqual({
      type: "uri", label: "開く", uri: "https://example.com/foo",
    });
  });

  it('type="uri" で http:// URL は reject', () => {
    expect(buildImageActionFlex({
      imageUrl: HTTPS_IMG, altText: null,
      imageAction: { type: "uri", text: null, url: "http://example.com/foo", liffPageId: null, postbackData: null },
    })).toBeNull();
  });

  it('type="liff" は liffEndpointUrl が無いと null', () => {
    expect(buildImageActionFlex({
      imageUrl: HTTPS_IMG, altText: null,
      imageAction: { type: "liff", text: null, url: null, liffPageId: "p1", postbackData: null },
    })).toBeNull();
  });

  it("未知の type は null", () => {
    expect(buildImageActionFlex({
      imageUrl: HTTPS_IMG, altText: null,
      imageAction: { type: "unknown-future-type", text: null, url: null, liffPageId: null, postbackData: null },
    })).toBeNull();
  });
});

describe("createMessageSchema with image_action_*", () => {
  const base = {
    work_id: "11111111-1111-1111-1111-111111111111",
    message_type: "image" as const,
    asset_url: HTTPS_IMG,
    kind: "normal" as const,
  };

  it("image_action_type=null (= 未設定) は受理 (既存挙動)", () => {
    const r = createMessageSchema.safeParse({ ...base });
    expect(r.success).toBe(true);
  });

  it('image_action_type="message" + text あり は受理', () => {
    const r = createMessageSchema.safeParse({
      ...base, image_action_type: "message", image_action_text: "古い写真を見る",
    });
    expect(r.success).toBe(true);
  });

  it('image_action_type="message" で text 未入力 は reject', () => {
    const r = createMessageSchema.safeParse({
      ...base, image_action_type: "message",
    });
    expect(r.success).toBe(false);
  });

  it('image_action_type="message" で text 空白のみ は reject', () => {
    const r = createMessageSchema.safeParse({
      ...base, image_action_type: "message", image_action_text: "   ",
    });
    expect(r.success).toBe(false);
  });

  it('image_action_type="uri" + HTTPS URL は受理', () => {
    const r = createMessageSchema.safeParse({
      ...base, image_action_type: "uri", image_action_url: "https://example.com/",
    });
    expect(r.success).toBe(true);
  });

  it('image_action_type="uri" + http:// URL は reject', () => {
    const r = createMessageSchema.safeParse({
      ...base, image_action_type: "uri", image_action_url: "http://example.com/",
    });
    expect(r.success).toBe(false);
  });

  it("message_type=text にアクション設定は reject", () => {
    const r = createMessageSchema.safeParse({
      work_id: "11111111-1111-1111-1111-111111111111",
      message_type: "text", body: "hello", kind: "normal",
      image_action_type: "message", image_action_text: "x",
    });
    expect(r.success).toBe(false);
  });
});

describe("updateMessageSchema with image_action_*", () => {
  it('image_action_type="none" で送ると null 化されるべき (PATCH 用)', () => {
    const r = updateMessageSchema.safeParse({
      image_action_type: "none",
    });
    expect(r.success).toBe(true);
  });
  it('uri アクションで URL を null に更新する PATCH は reject', () => {
    const r = updateMessageSchema.safeParse({
      image_action_type: "uri", image_action_url: null,
    });
    expect(r.success).toBe(false);
  });
});
