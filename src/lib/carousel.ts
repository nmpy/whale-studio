// src/lib/carousel.ts
//
// メッセージタイプ「カルーセル」の型・正規化アダプタ・バリデーション・Flex payload 生成を集約した
// 純ロジック（no JSX → node テスト可）。
//
// 保存形式: 既存どおり message.body に JSON 文字列で保存する（DB migration なし）。
//   - 旧形式: MessageCarouselCard[] のベア配列（{ image_url, title, body, button_label, button_url }）。
//   - 新形式: { type:"carousel", cardType, cards:[...] } オブジェクト。
//   normalizeCarouselContent() が両形式を新形式へ正規化する（後方互換）。
//
// 1 つのカルーセル内ではカードタイプは 1 種類に統一（content.cardType）。最大 5 枚。
// アクションは URL（uri action）/ テキスト（message action）のみ。

export type CarouselCardType = "product" | "location" | "person" | "image";
export type CarouselActionType = "url" | "text";

export const CAROUSEL_CARD_TYPES: CarouselCardType[] = ["product", "location", "person", "image"];
export const CAROUSEL_MAX_CARDS = 5;
export const DEFAULT_CARD_TYPE: CarouselCardType = "product";
export const DEFAULT_PRICE_CURRENCY = "¥";

/** カード共通のアクション。url のとき url、text のとき text を使う（label は必須）。 */
export interface CarouselAction {
  type:  CarouselActionType;
  label: string;
  url?:  string;
  text?: string;
}

/**
 * カード（フラット形）。カードタイプは content.cardType に統一されるため、
 * 各タイプ固有フィールドは optional で保持する（1 カルーセル＝1 タイプ）。
 */
export interface CarouselCard {
  id?:            string;
  imageUrl?:      string;
  action:         CarouselAction;
  // product / person
  name?:          string;
  // product / location
  title?:         string;
  // product / person
  description?:   string;
  // product（価格）
  priceCurrency?: string;
  price?:         string;
  // location
  address?:       string;
  extraInfo?:     string;
}

export interface CarouselMessageContent {
  type:     "carousel";
  cardType: CarouselCardType;
  cards:    CarouselCard[];
}

// ──────────────────────────────────────────────────────────────────────────
// 初期カード雛形
// ──────────────────────────────────────────────────────────────────────────

const EMPTY_ACTION = (): CarouselAction => ({ type: "url", label: "", url: "" });

/** 指定カードタイプの空カードを返す（カードタイプ変更時のリセットや新規追加で使う）。 */
export function emptyCarouselCard(cardType: CarouselCardType): CarouselCard {
  const base: CarouselCard = { imageUrl: "", action: EMPTY_ACTION() };
  switch (cardType) {
    case "product":  return { ...base, name: "", title: "", description: "", priceCurrency: DEFAULT_PRICE_CURRENCY, price: "" };
    case "location": return { ...base, title: "", address: "", extraInfo: "" };
    case "person":   return { ...base, name: "", description: "" };
    case "image":    return { ...base };
  }
}

export function emptyCarouselContent(cardType: CarouselCardType = DEFAULT_CARD_TYPE): CarouselMessageContent {
  return { type: "carousel", cardType, cards: [emptyCarouselCard(cardType)] };
}

// ──────────────────────────────────────────────────────────────────────────
// 正規化アダプタ（旧形式 / 新形式 / 文字列 / 不正値 → 新形式）
// ──────────────────────────────────────────────────────────────────────────

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const isCardType = (v: unknown): v is CarouselCardType =>
  typeof v === "string" && (CAROUSEL_CARD_TYPES as string[]).includes(v);

/** action 部分を正規化（label + type + url/text）。不明なら url 空アクション。 */
function normalizeAction(raw: unknown): CarouselAction {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const type: CarouselActionType = o.type === "text" ? "text" : "url";
    const label = str(o.label);
    if (type === "text") return { type, label, text: str(o.text) };
    return { type, label, url: str(o.url) };
  }
  return EMPTY_ACTION();
}

/** 旧形式カード（{ image_url, title, body, button_label, button_url }）→ product カード。 */
function normalizeLegacyCard(raw: unknown): CarouselCard {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    imageUrl:      str(o.image_url),
    title:         str(o.title),
    description:   str(o.body),
    name:          "",
    priceCurrency: DEFAULT_PRICE_CURRENCY,
    price:         "",
    // 旧カードのボタンは URL 遷移。button_url が空でも shape は保持（編集画面で補完）。
    action: { type: "url", label: str(o.button_label), url: str(o.button_url) },
  };
}

/** 新形式カードを cardType に合わせて正規化（不明フィールドは破棄）。 */
function normalizeNewCard(raw: unknown, cardType: CarouselCardType): CarouselCard {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const card: CarouselCard = {
    imageUrl: str(o.imageUrl) || str(o.image_url),
    action:   normalizeAction(o.action),
  };
  if (typeof o.id === "string") card.id = o.id;
  if (cardType === "product") {
    card.name = str(o.name);
    card.title = str(o.title);
    card.description = str(o.description);
    card.priceCurrency = str(o.priceCurrency) || DEFAULT_PRICE_CURRENCY;
    card.price = str(o.price);
  } else if (cardType === "location") {
    card.title = str(o.title);
    card.address = str(o.address);
    card.extraInfo = str(o.extraInfo);
  } else if (cardType === "person") {
    card.name = str(o.name);
    card.description = str(o.description);
  }
  // image: 追加フィールドなし
  return card;
}

/**
 * 任意の保存値（旧ベア配列 / 新オブジェクト / JSON 文字列 / null / 不正）を新形式へ正規化する。
 * 例外を投げず、編集画面でクラッシュしないことを保証する。
 */
export function normalizeCarouselContent(raw: unknown): CarouselMessageContent {
  let value = raw;
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return { type: "carousel", cardType: DEFAULT_CARD_TYPE, cards: [] };
    try { value = JSON.parse(s); } catch { return { type: "carousel", cardType: DEFAULT_CARD_TYPE, cards: [] }; }
  }

  // 旧形式: ベア配列 → 全カード product 扱い
  if (Array.isArray(value)) {
    return { type: "carousel", cardType: "product", cards: value.map(normalizeLegacyCard) };
  }

  // 新形式: { cardType, cards } / { type:"carousel", cardType, cards }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const cardType: CarouselCardType = isCardType(o.cardType) ? o.cardType : DEFAULT_CARD_TYPE;
    const rawCards = Array.isArray(o.cards) ? o.cards : [];
    return { type: "carousel", cardType, cards: rawCards.map((c) => normalizeNewCard(c, cardType)) };
  }

  return { type: "carousel", cardType: DEFAULT_CARD_TYPE, cards: [] };
}

/** 保存用の文字列（message.body へ入れる JSON）。 */
export function serializeCarouselContent(content: CarouselMessageContent): string {
  return JSON.stringify({ type: "carousel", cardType: content.cardType, cards: content.cards });
}

// ──────────────────────────────────────────────────────────────────────────
// バリデーション（保存前）
// ──────────────────────────────────────────────────────────────────────────

/** 1 件でも問題があれば日本語エラーメッセージを返す。問題なければ null。 */
export function validateCarousel(content: CarouselMessageContent): string | null {
  if (!isCardType(content.cardType)) return "カードタイプが不正です。";
  const cards = content.cards ?? [];
  if (cards.length < 1) return "カードを1枚以上追加してください。";
  if (cards.length > CAROUSEL_MAX_CARDS) return `カルーセルカードは最大${CAROUSEL_MAX_CARDS}枚までです。`;

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const n = i + 1;
    const a = c.action;
    if (!a || !str(a.label).trim()) return `カード${n}: アクションラベルを入力してください。`;
    if (a.type === "url"  && !str(a.url).trim())  return `カード${n}: URL を入力してください。`;
    if (a.type === "text" && !str(a.text).trim()) return `カード${n}: 送信テキストを入力してください。`;

    if (content.cardType === "product"  && !str(c.title).trim()) return `カード${n}: タイトルを入力してください。`;
    if (content.cardType === "location" && !str(c.title).trim()) return `カード${n}: タイトルを入力してください。`;
    if (content.cardType === "person"   && !str(c.name).trim())  return `カード${n}: 名前を入力してください。`;
    // image: 画像・テキストは任意（action のみ必須）
  }
  return null;
}

export function isCarouselValid(content: CarouselMessageContent): boolean {
  return validateCarousel(content) === null;
}

// ──────────────────────────────────────────────────────────────────────────
// Flex payload 生成（送信用）
// ──────────────────────────────────────────────────────────────────────────

type FlexNode = Record<string, unknown>;

const HERO_ASPECT: Record<CarouselCardType, string> = {
  product:  "20:13",
  location: "20:13",
  person:   "20:13",
  image:    "1.51:1",
};

/** action が有効（label + url/text）なら Flex action を返す。無効なら null。 */
function toFlexAction(a: CarouselAction | undefined): FlexNode | null {
  if (!a || !str(a.label).trim()) return null;
  if (a.type === "text") {
    const text = str(a.text).trim();
    return text ? { type: "message", label: a.label, text } : null;
  }
  const uri = str(a.url).trim();
  return uri ? { type: "uri", label: a.label, uri } : null;
}

const txt = (text: string, opts: FlexNode = {}): FlexNode => ({ type: "text", text, wrap: true, ...opts });

/** カード 1 枚 → bubble。表示できる中身が無ければ null（送信時に安全に除外）。 */
function cardToBubble(card: CarouselCard, cardType: CarouselCardType): FlexNode | null {
  const bodyContents: FlexNode[] = [];

  if (cardType === "product") {
    if (str(card.name).trim())  bodyContents.push(txt(card.name!.trim(), { size: "xs", color: "#8c8c8c" }));
    if (str(card.title).trim()) bodyContents.push(txt(card.title!.trim(), { weight: "bold", size: "lg" }));
    if (str(card.description).trim()) bodyContents.push(txt(card.description!.trim(), { size: "sm", color: "#555555" }));
    const price = str(card.price).trim();
    if (price) bodyContents.push(txt(`${str(card.priceCurrency).trim() || DEFAULT_PRICE_CURRENCY}${price}`, { weight: "bold", size: "md", color: "#111111", margin: "md" }));
  } else if (cardType === "location") {
    if (str(card.title).trim())     bodyContents.push(txt(card.title!.trim(), { weight: "bold", size: "lg" }));
    if (str(card.address).trim())   bodyContents.push(txt(`📍 ${card.address!.trim()}`, { size: "sm", color: "#555555" }));
    if (str(card.extraInfo).trim()) bodyContents.push(txt(`ℹ️ ${card.extraInfo!.trim()}`, { size: "sm", color: "#8c8c8c" }));
  } else if (cardType === "person") {
    if (str(card.name).trim())        bodyContents.push(txt(card.name!.trim(), { weight: "bold", size: "lg", align: "center" }));
    if (str(card.description).trim()) bodyContents.push(txt(card.description!.trim(), { size: "sm", color: "#555555", align: "center" }));
  }
  // image: 本文テキストなし

  const heroUrl = str(card.imageUrl).trim();
  const hero: FlexNode | null = heroUrl
    ? { type: "image", url: heroUrl, size: "full", aspectRatio: HERO_ASPECT[cardType], aspectMode: "cover" }
    : null;

  const flexAction = toFlexAction(card.action);
  const footer: FlexNode | null = flexAction
    ? { type: "box", layout: "vertical", spacing: "sm", contents: [{ type: "button", style: "primary", height: "sm", action: flexAction }] }
    : null;

  const bubble: FlexNode = { type: "bubble" };
  if (hero) bubble.hero = hero;
  if (bodyContents.length > 0) bubble.body = { type: "box", layout: "vertical", spacing: "sm", contents: bodyContents };
  if (footer) bubble.footer = footer;

  // bubble は hero/body/footer のいずれかが必要。全部無ければ送れないので除外。
  if (!hero && bodyContents.length === 0 && !footer) return null;
  return bubble;
}

export interface CarouselFlexMessage {
  type: "flex";
  altText: string;
  contents: FlexNode;
}

/**
 * カルーセル content → LINE Flex carousel メッセージ。
 * - 最大 5 枚（超過分は無視）。
 * - 表示できないカードは安全に除外。送れる bubble が 0 なら null（＝送信不可）。
 * - altText はフォーム値 → 先頭カードのタイトル/名前 → 既定 "カルーセル"。
 */
export function buildCarouselFlex(
  content: CarouselMessageContent | null | undefined,
  opts: { altText?: string | null } = {},
): CarouselFlexMessage | null {
  if (!content || !Array.isArray(content.cards)) return null;
  const cardType: CarouselCardType = isCardType(content.cardType) ? content.cardType : DEFAULT_CARD_TYPE;

  const bubbles = content.cards
    .slice(0, CAROUSEL_MAX_CARDS)
    .map((c) => cardToBubble(c, cardType))
    .filter((b): b is FlexNode => b !== null);

  if (bubbles.length === 0) return null;

  const first = content.cards[0] ?? {};
  const derived = str(first.title).trim() || str(first.name).trim() || "カルーセル";
  const altText = (str(opts.altText).trim() || derived).slice(0, 400);

  return { type: "flex", altText, contents: { type: "carousel", contents: bubbles } };
}
