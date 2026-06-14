// src/lib/x-posts/nlp.ts
// 口コミ（CSV 取り込みテキスト）の簡易 NLP（サーバー専用）。
// ルールベース。将来 LLM 分類へ差し替えられるよう、分類関数を分離している。
// X API / スクレイピングは一切使わない（CSV 由来テキストのみが対象）。

import crypto from "crypto";

export type Sentiment = "positive" | "neutral" | "negative" | "unknown";
export type RepeatIntent = "high" | "medium" | "low" | "unknown";

// ── 重複判定用テキストハッシュ ──
export function textHash(text: string): string {
  const norm = (text ?? "").trim().normalize("NFKC").toLowerCase();
  return crypto.createHash("sha256").update(norm).digest("hex");
}

// ── ストップワード ──
const STOPWORDS = new Set<string>([
  "これ", "それ", "あれ", "こと", "もの", "さん", "する", "いる", "ある", "なる",
  "です", "ます", "した", "して", "から", "ので", "けど", "ため", "よう", "そう",
  "https", "http", "t.co", "rt", "x", "twitter",
  "の", "に", "は", "を", "が", "で", "と", "も", "や", "へ", "て", "た", "な", "ね", "よ",
]);

// ── 感情キーワード（部分一致） ──
const POSITIVE_WORDS = [
  "面白い", "おもしろい", "楽しい", "たのしい", "最高", "好き", "没入", "すごい", "凄い",
  "よかった", "良かった", "またやりたい", "おすすめ", "オススメ", "感動", "素敵", "天才",
  "神", "神ゲー", "傑作", "泣いた", "笑った", "わくわく", "ワクワク", "満足",
];
const NEGATIVE_WORDS = [
  "わかりにくい", "分かりにくい", "難しい", "むずかしい", "つまらない", "つまんない",
  "バグ", "動かない", "迷った", "不満", "微妙", "疲れた", "しんどい", "できない",
  "ひどい", "酷い", "残念", "最悪", "意味不明", "理不尽",
];

// ── リピート欲求キーワード（部分一致・優先度: high > medium > low） ──
const REPEAT_HIGH = [
  "またやりたい", "もう一回やりたい", "もう一度やりたい", "もう一度遊びたい", "続編希望",
  "次回作", "他の作品も", "他の作品", "遊びたい", "友達に勧め", "友達に薦め", "誰かとやりたい",
  "布教", "リピートしたい", "また行きたい", "また参加",
];
const REPEAT_MED = [
  "楽しかった", "面白かった", "おもしろかった", "よかった", "良かった", "満足", "おすすめ", "オススメ", "好き",
];
const REPEAT_LOW = [
  "もういい", "合わなかった", "疲れた", "難しすぎた", "むずかしすぎ", "わからなかった", "分からなかった", "しんどい",
];

function countMatches(text: string, words: string[]): string[] {
  const matched: string[] = [];
  for (const w of words) if (text.includes(w)) matched.push(w);
  return matched;
}

/** ポジネガ分類（ルールベース）。将来 LLM に差し替える場合はこの関数を置換する。 */
export function analyzeSentiment(text: string): { sentiment: Sentiment; score: number; matched: string[] } {
  const t = (text ?? "").trim();
  if (!t) return { sentiment: "unknown", score: 0, matched: [] };
  const pos = countMatches(t, POSITIVE_WORDS);
  const neg = countMatches(t, NEGATIVE_WORDS);
  const score = pos.length - neg.length;
  let sentiment: Sentiment;
  if (pos.length === 0 && neg.length === 0) sentiment = "neutral";
  else if (score > 0) sentiment = "positive";
  else if (score < 0) sentiment = "negative";
  else sentiment = "neutral"; // 同数
  return { sentiment, score, matched: [...pos, ...neg] };
}

/** リピート欲求分類（ルールベース）。 */
export function analyzeRepeatIntent(text: string): { repeatIntent: RepeatIntent; score: number; matched: string[] } {
  const t = (text ?? "").trim();
  if (!t) return { repeatIntent: "unknown", score: 0, matched: [] };
  const high = countMatches(t, REPEAT_HIGH);
  if (high.length > 0) return { repeatIntent: "high", score: high.length, matched: high };
  const med = countMatches(t, REPEAT_MED);
  if (med.length > 0) return { repeatIntent: "medium", score: med.length, matched: med };
  const low = countMatches(t, REPEAT_LOW);
  if (low.length > 0) return { repeatIntent: "low", score: low.length, matched: low };
  return { repeatIntent: "unknown", score: 0, matched: [] };
}

/** high 判定に使う代表的な「リピート欲求が高い表現」一覧（ランキング集計用）。 */
export const REPEAT_HIGH_EXPRESSIONS = REPEAT_HIGH;

/** 簡易トークナイズ（日本語対応・形態素解析なし）。URL/記号/1文字/ストップワードを除外。 */
export function tokenizeJa(text: string): string[] {
  const cleaned = (text ?? "")
    .replace(/https?:\/\/\S+/g, " ")   // URL 除去
    .replace(/[#＃]\S+/g, " ")          // ハッシュタグ除去
    .replace(/@\S+/g, " ");             // メンション除去
  // 漢字 / ひらがな / カタカナ / 英数語 の連続を抽出
  const tokens = cleaned.match(/[一-龯々〆ヵヶ]+|[ぁ-ん]+|[ァ-ヴー]+|[a-zA-Z][a-zA-Z0-9]+/g) ?? [];
  return tokens
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 2)        // 1文字は除外（助詞等）
    .filter((t) => !STOPWORDS.has(t));
}

/** 頻出単語ランキング（出現回数 + 関連口コミ数）。 */
export function frequentWords(
  mentions: { id: string; text: string }[],
  limit = 30,
): { word: string; count: number; mentionCount: number }[] {
  const count = new Map<string, number>();
  const mentionSet = new Map<string, Set<string>>();
  for (const m of mentions) {
    const seen = new Set<string>();
    for (const tok of tokenizeJa(m.text)) {
      count.set(tok, (count.get(tok) ?? 0) + 1);
      if (!seen.has(tok)) {
        seen.add(tok);
        if (!mentionSet.has(tok)) mentionSet.set(tok, new Set());
        mentionSet.get(tok)!.add(m.id);
      }
    }
  }
  return Array.from(count.entries())
    .map(([word, c]) => ({ word, count: c, mentionCount: mentionSet.get(word)?.size ?? 0 }))
    .sort((a, b) => b.count - a.count || b.mentionCount - a.mentionCount)
    .slice(0, limit);
}
