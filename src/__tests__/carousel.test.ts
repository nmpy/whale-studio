/**
 * src/__tests__/carousel.test.ts
 * カルーセル（カードタイプ式）の純ロジック: 正規化アダプタ / バリデーション / Flex payload 生成。
 */
import { describe, it, expect } from "vitest";
import {
  normalizeCarouselContent,
  validateCarousel,
  buildCarouselFlex,
  emptyCarouselCard,
  serializeCarouselContent,
  CAROUSEL_MAX_CARDS,
  type CarouselMessageContent,
  type CarouselCard,
} from "@/lib/carousel";

// ── ヘルパ: 有効カードを作る ──
const productCard = (over: Partial<CarouselCard> = {}): CarouselCard => ({
  title: "T", action: { type: "url", label: "詳細", url: "https://e.com" }, ...over,
});
const content = (cardType: CarouselMessageContent["cardType"], cards: CarouselCard[]): CarouselMessageContent =>
  ({ type: "carousel", cardType, cards });

describe("validateCarousel — タイプ別必須", () => {
  it("product: title 必須・name/description/price 任意 → 通る", () => {
    expect(validateCarousel(content("product", [productCard({ name: "", description: "", price: "" })]))).toBeNull();
  });
  it("location: title 必須 → 通る", () => {
    expect(validateCarousel(content("location", [{ title: "店", action: { type: "url", label: "地図", url: "https://m" } }]))).toBeNull();
  });
  it("person: name 必須 → 通る", () => {
    expect(validateCarousel(content("person", [{ name: "山田", action: { type: "url", label: "見る", url: "https://p" } }]))).toBeNull();
  });
  it("image: 画像/テキスト任意・action のみ必須 → 通る（imageUrl 無くても）", () => {
    expect(validateCarousel(content("image", [{ action: { type: "url", label: "開く", url: "https://i" } }]))).toBeNull();
  });

  it("cards 0 枚 → エラー", () => {
    expect(validateCarousel(content("product", []))).toMatch(/1枚以上/);
  });
  it("cards 6 枚 → エラー", () => {
    expect(validateCarousel(content("product", Array.from({ length: 6 }, () => productCard())))).toMatch(/最大5枚/);
  });
  it("action label 空 → エラー", () => {
    expect(validateCarousel(content("product", [productCard({ action: { type: "url", label: "", url: "https://e" } })]))).toMatch(/アクションラベル/);
  });
  it("action type=url で url 空 → エラー", () => {
    expect(validateCarousel(content("product", [productCard({ action: { type: "url", label: "詳細", url: "" } })]))).toMatch(/URL/);
  });
  it("action type=text で text 空 → エラー", () => {
    expect(validateCarousel(content("product", [productCard({ action: { type: "text", label: "送る", text: "" } })]))).toMatch(/送信テキスト/);
  });
  it("product で title 空 → エラー", () => {
    expect(validateCarousel(content("product", [productCard({ title: "" })]))).toMatch(/タイトル/);
  });
  it("person で name 空 → エラー", () => {
    expect(validateCarousel(content("person", [{ name: "", action: { type: "url", label: "見る", url: "https://p" } }]))).toMatch(/名前/);
  });
});

describe("normalizeCarouselContent — 後方互換アダプタ", () => {
  it("旧形式（ベア配列）→ 全カード product として正規化", () => {
    const legacy = [{ image_url: "https://img", title: "旧T", body: "旧本文", button_label: "ボタン", button_url: "https://b" }];
    const norm = normalizeCarouselContent(JSON.stringify(legacy));
    expect(norm.cardType).toBe("product");
    expect(norm.cards).toHaveLength(1);
    expect(norm.cards[0].title).toBe("旧T");
    expect(norm.cards[0].description).toBe("旧本文");
    expect(norm.cards[0].imageUrl).toBe("https://img");
    expect(norm.cards[0].action).toEqual({ type: "url", label: "ボタン", url: "https://b" });
  });
  it("新形式オブジェクト → そのまま正規化（cardType 保持）", () => {
    const obj = { type: "carousel", cardType: "location", cards: [{ title: "店", address: "東京", action: { type: "text", label: "送る", text: "hi" } }] };
    const norm = normalizeCarouselContent(JSON.stringify(obj));
    expect(norm.cardType).toBe("location");
    expect(norm.cards[0].address).toBe("東京");
    expect(norm.cards[0].action).toEqual({ type: "text", label: "送る", text: "hi" });
  });
  it("null / 空文字 / 不正 JSON → 空カルーセル（落ちない）", () => {
    for (const bad of [null, undefined, "", "   ", "{not json", "42"]) {
      const norm = normalizeCarouselContent(bad as unknown);
      expect(norm.type).toBe("carousel");
      expect(Array.isArray(norm.cards)).toBe(true);
    }
  });
  it("不正な cardType → product にフォールバック", () => {
    const norm = normalizeCarouselContent(JSON.stringify({ cardType: "xxx", cards: [] }));
    expect(norm.cardType).toBe("product");
  });
  it("serialize → normalize で round-trip", () => {
    const c = content("person", [{ name: "山田", description: "説明", imageUrl: "https://p", action: { type: "url", label: "見る", url: "https://u" } }]);
    expect(normalizeCarouselContent(serializeCarouselContent(c))).toEqual(c);
  });
});

describe("buildCarouselFlex — Flex carousel payload", () => {
  const flex = (c: CarouselMessageContent, alt?: string) => buildCarouselFlex(c, { altText: alt });

  it("product → flex carousel / bubble 構造", () => {
    const f = flex(content("product", [productCard({ name: "N", description: "D", price: "1,000", priceCurrency: "¥" })]))!;
    expect(f.type).toBe("flex");
    expect((f.contents as { type: string }).type).toBe("carousel");
    const bubbles = (f.contents as { contents: unknown[] }).contents;
    expect(bubbles).toHaveLength(1);
    expect((bubbles[0] as { type: string }).type).toBe("bubble");
  });
  it("location / person / image も flex carousel になる", () => {
    expect(flex(content("location", [{ title: "店", address: "東京", action: { type: "url", label: "地図", url: "https://m" } }]))!.contents).toHaveProperty("type", "carousel");
    expect(flex(content("person", [{ name: "山田", action: { type: "url", label: "見る", url: "https://p" } }]))!.contents).toHaveProperty("type", "carousel");
    expect(flex(content("image", [{ imageUrl: "https://i", action: { type: "url", label: "開く", url: "https://o" } }]))!.contents).toHaveProperty("type", "carousel");
  });
  it("URL action → uri action になる", () => {
    const f = flex(content("product", [productCard({ action: { type: "url", label: "詳細", url: "https://e.com" } })]))!;
    const footer = ((f.contents as { contents: Array<{ footer: { contents: Array<{ action: { type: string; uri?: string } }> } }> }).contents)[0].footer;
    expect(footer.contents[0].action).toEqual({ type: "uri", label: "詳細", uri: "https://e.com" });
  });
  it("テキスト action → message action になる", () => {
    const f = flex(content("product", [productCard({ action: { type: "text", label: "送る", text: "こんにちは" } })]))!;
    const footer = ((f.contents as { contents: Array<{ footer: { contents: Array<{ action: { type: string; text?: string } }> } }> }).contents)[0].footer;
    expect(footer.contents[0].action).toEqual({ type: "message", label: "送る", text: "こんにちは" });
  });
  it("最大5枚までしか payload に含めない（6枚目以降は無視）", () => {
    const c = content("product", Array.from({ length: 7 }, (_, i) => productCard({ title: `T${i}` })));
    const f = flex(c)!;
    expect((f.contents as { contents: unknown[] }).contents).toHaveLength(CAROUSEL_MAX_CARDS);
  });
  it("画像未設定カードでも hero を省略して壊れない", () => {
    const f = flex(content("image", [{ action: { type: "url", label: "開く", url: "https://o" } }]))!;
    const bubble = (f.contents as { contents: Array<Record<string, unknown>> }).contents[0];
    expect(bubble.hero).toBeUndefined();
    expect(bubble.footer).toBeDefined(); // action だけでも bubble は成立
  });
  it("カードが 0 枚 / 表示要素なし → null（送信不可）", () => {
    expect(flex(content("product", []))).toBeNull();
    // 画像も本文も有効アクションも無いカード → 除外され、結果 0 bubble → null
    expect(flex(content("image", [{ action: { type: "url", label: "", url: "" } }]))).toBeNull();
  });
  it("altText: 指定 > 先頭カード由来 > 既定", () => {
    expect(flex(content("product", [productCard({ title: "商品A" })]), "明示alt")!.altText).toBe("明示alt");
    expect(flex(content("product", [productCard({ title: "商品A" })]))!.altText).toBe("商品A");
  });
  it("null content / cards 非配列でも落ちず null", () => {
    expect(buildCarouselFlex(null)).toBeNull();
    expect(buildCarouselFlex({ type: "carousel", cardType: "product", cards: undefined as unknown as CarouselCard[] })).toBeNull();
  });
});

describe("旧形式 → Flex 送信安全性（normalize → buildCarouselFlex）", () => {
  const fromLegacy = (cards: unknown[]) => buildCarouselFlex(normalizeCarouselContent(JSON.stringify(cards)));

  it("旧形式 carousel が Flex carousel payload として生成される", () => {
    const f = fromLegacy([{ image_url: "https://i", title: "旧T", body: "本文", button_label: "見る", button_url: "https://b" }])!;
    expect((f.contents as { type: string }).type).toBe("carousel");
    const footer = ((f.contents as { contents: Array<{ footer?: { contents: Array<{ action: { type: string } }> } }> }).contents)[0].footer!;
    expect(footer.contents[0].action.type).toBe("uri"); // 旧ボタンは URL 遷移
  });
  it("旧形式で画像なしでも payload 生成が落ちない（hero 省略）", () => {
    const f = fromLegacy([{ title: "T", body: "B", button_label: "見る", button_url: "https://b" }])!;
    const bubble = (f.contents as { contents: Array<Record<string, unknown>> }).contents[0];
    expect(bubble.hero).toBeUndefined();
    expect(bubble.body).toBeDefined();
  });
  it("旧形式で title が不足していても payload 生成が落ちない", () => {
    // title 空・body のみ → bubble は body(description) と footer で成立
    const f = fromLegacy([{ image_url: "https://i", button_label: "見る", button_url: "https://b" }])!;
    expect((f.contents as { contents: unknown[] }).contents).toHaveLength(1);
  });
  it("正規化不能 / 空 carousel は null（line.ts 側で text fallback）", () => {
    expect(buildCarouselFlex(normalizeCarouselContent("{not json"))).toBeNull();
    expect(buildCarouselFlex(normalizeCarouselContent("[]"))).toBeNull();
    expect(buildCarouselFlex(normalizeCarouselContent(null as unknown))).toBeNull();
  });
  it("payload 生成は例外を投げない（壊れたカード shape でも）", () => {
    expect(() => buildCarouselFlex({ type: "carousel", cardType: "product", cards: [{} as never, { action: null as never }, 42 as never] })).not.toThrow();
  });
  it("旧形式 6 枚以上 → 送信 payload は最大 5 枚に丸める", () => {
    const legacy = Array.from({ length: 8 }, (_, i) => ({ title: `T${i}`, button_label: "見る", button_url: "https://b" }));
    const f = fromLegacy(legacy)!;
    expect((f.contents as { contents: unknown[] }).contents).toHaveLength(CAROUSEL_MAX_CARDS);
  });
});

describe("emptyCarouselCard — タイプ別初期カード", () => {
  it("product は priceCurrency 既定 ¥", () => {
    expect(emptyCarouselCard("product").priceCurrency).toBe("¥");
  });
  it("各タイプで action.type=url の空アクションを持つ", () => {
    for (const t of ["product", "location", "person", "image"] as const) {
      expect(emptyCarouselCard(t).action).toEqual({ type: "url", label: "", url: "" });
    }
  });
});
