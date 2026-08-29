/**
 * src/__tests__/carousel-invalid-uri.test.ts
 *
 * 「応答キーワードを送ってもカルーセルが飛んでこない」事故（D.O.T / 2026-08）の再発防止。
 *
 * 原因: カード1 の action.url に URL ではなく説明文が入っていた。
 *   `toFlexAction` は空チェックしかしていなかったため
 *   `{ type:"uri", uri:"この度は公演に…" }` を生成し、LINE API が
 *   **メッセージ全体**を 400 で拒否 → 3 枚とも 1 枚も届かなかった。
 *   保存時の `validateCarousel` も空チェックのみで、CMS で保存できてしまっていた。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildCarouselFlex,
  validateCarousel,
  CAROUSEL_ACTION_LABEL_MAX,
  type CarouselMessageContent,
} from "@/lib/carousel";

/** D.O.T で実際に保存されていた内容（URL 欄に説明文が入っている）。 */
const REAL_BROKEN: CarouselMessageContent = {
  type: "carousel",
  cardType: "product",
  cards: [
    {
      imageUrl: "https://res.cloudinary.com/duvd61vx6/image/upload/v1/anke-to.png",
      action: {
        type: "url",
        label: "回答する",
        url: "この度は公演にご参加いただきありがとうございます。 アンケートの回答にご協力いただけますと幸いです。",
      },
      name: "",
      title: "アンケート",
      description: "この度は公演にご参加いただきありがとうございます。",
      priceCurrency: "¥",
      price: "",
    },
    {
      imageUrl: "https://res.cloudinary.com/duvd61vx6/image/upload/v1/kaisetsu.png",
      action: { type: "url", label: "解説をみる", url: "https://liff.line.me/2010632002-ZzzimCzc/w/q6v7188co7/p/as809794lc" },
      name: "", title: "解説", description: "", priceCurrency: "¥", price: "",
    },
    {
      imageUrl: "https://res.cloudinary.com/duvd61vx6/image/upload/v1/netabare.png",
      action: { type: "url", label: "確認する", url: "https://app.whale-studio.app/liff/w/q6v7188co7/p/as809794lc" },
      name: "", title: "ネタバレガイドライン", description: "", priceCurrency: "¥", price: "",
    },
  ],
};

type Bubble = { hero?: unknown; body?: unknown; footer?: { contents: { action: { type: string; uri?: string; label: string } }[] } };
const bubblesOf = (flex: ReturnType<typeof buildCarouselFlex>): Bubble[] =>
  ((flex!.contents as { contents: Bubble[] }).contents);

describe("buildCarouselFlex — 不正 URI で全体を落とさない", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("URL 欄に本文が入っていても、3 枚とも送信できる形になる", () => {
    const flex = buildCarouselFlex(REAL_BROKEN);
    expect(flex).not.toBeNull();
    const bubbles = bubblesOf(flex);
    expect(bubbles).toHaveLength(3);
  });

  it("不正 URI のカードは action だけ落とし、画像・本文は残す", () => {
    const bubbles = bubblesOf(buildCarouselFlex(REAL_BROKEN));
    // card1: uri が不正 → footer(ボタン) なし。hero と body は残る
    expect(bubbles[0].footer).toBeUndefined();
    expect(bubbles[0].hero).toBeDefined();
    expect(bubbles[0].body).toBeDefined();
  });

  it("正常なカードのボタンはそのまま残る", () => {
    const bubbles = bubblesOf(buildCarouselFlex(REAL_BROKEN));
    expect(bubbles[1].footer!.contents[0].action).toMatchObject({
      type: "uri", label: "解説をみる",
      uri: "https://liff.line.me/2010632002-ZzzimCzc/w/q6v7188co7/p/as809794lc",
    });
    expect(bubbles[2].footer!.contents[0].action.uri).toBe("https://app.whale-studio.app/liff/w/q6v7188co7/p/as809794lc");
  });

  it("生成される JSON に不正な uri が 1 つも残らない（LINE が 400 を返さない）", () => {
    const json = JSON.stringify(buildCarouselFlex(REAL_BROKEN));
    // 本文(description)に同じ文が残るのは正しい。uri として出ていないことだけを見る。
    const uris = [...json.matchAll(/"uri":"([^"]*)"/g)].map((m) => m[1]);
    expect(uris).toHaveLength(2); // card1 のアクションだけが落ちる
    for (const uri of uris) expect(uri).toMatch(/^(https?|line|tel):/i);
  });

  it.each([
    ["http", "http://example.com", true],
    ["https", "https://example.com", true],
    ["line", "line://app/1234-abcd", true],
    ["tel", "tel:0123456789", true],
    ["日本語文", "これは説明文です", false],
    ["スキームなし", "example.com/page", false],
    ["javascript", "javascript:alert(1)", false],
    ["空白のみ", "   ", false],
  ])("uri スキーム: %s → action %s", (_name, url, kept) => {
    const content: CarouselMessageContent = {
      type: "carousel", cardType: "image",
      cards: [{ imageUrl: "https://example.com/a.png", action: { type: "url", label: "ボタン", url } }],
    };
    const bubbles = bubblesOf(buildCarouselFlex(content));
    expect(bubbles[0].footer !== undefined).toBe(kept);
  });

  it("text アクションは従来どおり message アクションになる", () => {
    const content: CarouselMessageContent = {
      type: "carousel", cardType: "image",
      cards: [{ imageUrl: "https://example.com/a.png", action: { type: "text", label: "送る", text: "こんにちは" } }],
    };
    const bubbles = bubblesOf(buildCarouselFlex(content));
    expect(bubbles[0].footer!.contents[0].action).toMatchObject({ type: "message", label: "送る", text: "こんにちは" });
  });

  it("label が上限超過でも 400 にならないよう詰める", () => {
    const content: CarouselMessageContent = {
      type: "carousel", cardType: "image",
      cards: [{ imageUrl: "https://example.com/a.png", action: { type: "url", label: "あ".repeat(30), url: "https://example.com" } }],
    };
    const bubbles = bubblesOf(buildCarouselFlex(content));
    expect(bubbles[0].footer!.contents[0].action.label).toHaveLength(CAROUSEL_ACTION_LABEL_MAX);
  });
});

describe("validateCarousel — 保存時に URL 形式を弾く", () => {
  const card = (url: string) => ({
    type: "carousel" as const, cardType: "product" as const,
    cards: [{ imageUrl: "", action: { type: "url" as const, label: "回答する", url }, title: "アンケート" }],
  });

  it("本文を URL 欄に貼った場合は保存できない（実際に起きたケース）", () => {
    const msg = validateCarousel(card("この度は公演にご参加いただきありがとうございます。"));
    expect(msg).toContain("http:// または https://");
  });

  it("スキームなしの URL も弾く", () => {
    expect(validateCarousel(card("example.com/form"))).toContain("http:// または https://");
  });

  it("空 URL は従来どおり必須エラー", () => {
    expect(validateCarousel(card(""))).toContain("URL を入力してください");
  });

  it("正しい URL は通る", () => {
    expect(validateCarousel(card("https://forms.gle/abc123"))).toBeNull();
  });

  it("ラベルが上限を超える場合は保存前に弾く", () => {
    const c = card("https://forms.gle/abc123");
    c.cards[0].action.label = "あ".repeat(CAROUSEL_ACTION_LABEL_MAX + 1);
    expect(validateCarousel(c)).toContain(`${CAROUSEL_ACTION_LABEL_MAX}文字以内`);
  });
});
