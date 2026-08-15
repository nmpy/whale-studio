// src/lib/liff/hint-search.ts
//
// 検索型ヒントページ (LiffPageConfig.pageType = "hint_search") の検索コア。
//
// 位置づけ:
//   - 副作用ゼロの純関数のみ。サーバー (検索 API) と CMS プレビュー (ローカル検索) の
//     双方から同じ実装を使い、挙動が二重化しないようにする。
//   - LLM 等でヒントを生成することは絶対にしない。登録済み hint_search_entries の中からのみ返す。
//   - internal_title は **検索対象にも含めない**。フェーズ番号 / 内部シナリオ名が入る想定のため、
//     "P7" のような入力で意図しないヒットが起きるのを避ける（表示もしない）。
//
// 正規化の方針 (表記ゆれ吸収):
//   1. NFKC 正規化      … 全角英数 → 半角 / 半角カナ → 全角カナ / 全角スペース → 半角スペース
//   2. trim + 連続空白の圧縮
//   3. 小文字化          … 大文字 / 小文字を同一視
//   4. カタカナ → ひらがな … "キーボード" と "きーぼーど" を同一視
//   長音記号 "ー" はそのまま残す（"きーぼーど" ↔ "キーボード" が一致するため）。
//   これ以上の曖昧検索（形態素解析・編集距離）は行わない。精度は aliases 登録で担保する。

import type { HintSearchEntry, HintSearchGuideNode, HintSearchHintLevel, HintSpoilerLevel } from "@/types";

/** 1 ページに登録できるヒント件数の上限。 */
export const HINT_SEARCH_MAX_ENTRIES = 200;
/** 1 ヒントが持てる段階数の上限（ヒント1 / ヒント2 / ヒント3）。 */
export const HINT_SEARCH_MAX_HINT_LEVELS = 3;
/** 検索クエリの最大文字数。これを超える入力は切り詰めてから検索する（長文入力対策）。 */
export const HINT_SEARCH_MAX_QUERY_LENGTH = 100;
/** スペース区切りで扱う最大トークン数。超過分は無視する。 */
export const HINT_SEARCH_MAX_TOKENS = 8;
/** 検索結果として返す最大件数。 */
export const HINT_SEARCH_MAX_RESULTS = 20;
/** 質問ツリーの最大深さ（質問1 → 質問2 → 質問3 まで）。 */
export const HINT_SEARCH_GUIDE_MAX_DEPTH = 3;
/** 1 つの質問が持てる選択肢の上限。 */
export const HINT_SEARCH_GUIDE_MAX_OPTIONS = 8;
/** 質問1 の既定文言。 */
export const HINT_SEARCH_GUIDE_DEFAULT_QUESTION = "いま、どちらに近い状態でしょうか。";

/** ランキング用スコア。title 完全 > alias 完全 > keyword 完全 > title 部分 > alias/keyword 部分。 */
const SCORE = {
  titleExact:     100,
  aliasExact:      80,
  keywordExact:    60,
  titlePartial:    40,
  termPartial:     20,
} as const;

/** 段階番号からネタバレ度を出す（保存はしない・表示専用）。ヒント1=低 / 2=中 / 3=高。 */
export function spoilerLevelForHint(level: number): HintSpoilerLevel {
  if (level <= 1) return "low";
  if (level === 2) return "medium";
  return "high";
}

/** 検索・表示に使える形へ正規化した 1 ヒント。 */
export interface NormalizedHintSearchEntry {
  /** 詳細取得のキー。entry.id があればそれ、無ければ配列位置由来の安定 ID。 */
  id: string;
  /** 検索結果 / 詳細見出しに出すプレイヤー向け名称。 */
  label: string;
  /** ヒント一覧に出すタイトル。 */
  listTitle: string;
  /** 詳細見出しの上に小さく出すカテゴリ。無ければ null。 */
  categoryLabel: string | null;
  /** 段階ヒント（配列順 = 開示順。level は 1 始まりに振り直し済み）。 */
  hints: HintSearchHintLevel[];
  /** 「答えを見る」で開示する結論。無ければ null（= 答えボタンを出さない）。 */
  answer: string | null;
  /** 正規化済みの検索対象（title = プレイヤー表示名）。 */
  titleTerms: string[];
  aliasTerms: string[];
  keywordTerms: string[];
  /** 元配列での位置。同スコア時の安定ソートに使う。 */
  index: number;
}

/** 検索ヒット 1 件。 */
export interface HintSearchMatch {
  entry: NormalizedHintSearchEntry;
  score: number;
  /** ヒットしたトークン数。多いほど「入力全体に近い」ため優先する。 */
  matchedTokens: number;
}

/** 検索・比較用のテキスト正規化。非文字列は "" を返す（settings_json は任意 JSON なので防御的に扱う）。 */
export function normalizeHintSearchText(input: unknown): string {
  if (typeof input !== "string") return "";
  let s = input.normalize("NFKC");
  s = s.replace(/[\s　]+/g, " ").trim();
  s = s.toLowerCase();
  // カタカナ → ひらがな（U+30A1〜U+30F6）。長音記号 U+30FC は範囲外なので保持される。
  s = s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  return s;
}

/** 入力文字列を検索トークンへ分解する。半角 / 全角スペース区切り・重複除去・上限あり。 */
export function tokenizeHintSearchQuery(raw: unknown): string[] {
  const truncated = typeof raw === "string" ? raw.slice(0, HINT_SEARCH_MAX_QUERY_LENGTH) : "";
  const normalized = normalizeHintSearchText(truncated);
  if (!normalized) return [];
  const tokens = normalized.split(" ").filter(Boolean);
  return Array.from(new Set(tokens)).slice(0, HINT_SEARCH_MAX_TOKENS);
}

/** 文字列配列を正規化して空要素を除いた検索語リストにする。 */
function toTerms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const terms = raw.map(normalizeHintSearchText).filter(Boolean);
  return Array.from(new Set(terms));
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 段階ヒントを「本文が空でないものだけ・配列順で level 1..N に振り直し」した形にする。 */
function normalizeHints(raw: unknown): HintSearchHintLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((h) => (h && typeof h === "object" ? trimmedString((h as { body?: unknown }).body) : ""))
    .filter((body) => body !== "")
    .slice(0, HINT_SEARCH_MAX_HINT_LEVELS)
    .map((body, i) => ({ level: i + 1, body }));
}

/**
 * settings_json.hint_search_entries を検索可能な形へ正規化する。
 *
 * 除外条件（= プレイヤーに出さない）:
 *   - search_result_label が空
 *   - 本文のある段階ヒントが 1 つも無く、答えも空
 * これにより、CMS で追加しただけの空行が検索結果 / 一覧に漏れない。
 */
export function normalizeHintSearchEntries(raw: unknown): NormalizedHintSearchEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalizedHintSearchEntry[] = [];
  raw.slice(0, HINT_SEARCH_MAX_ENTRIES).forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const e = item as HintSearchEntry;
    const label = trimmedString(e.search_result_label);
    const hints = normalizeHints(e.hints);
    const answer = trimmedString(e.answer);
    if (!label || (hints.length === 0 && answer === "")) return;
    const listTitle = trimmedString(e.list_title) || label;
    const rawId = trimmedString(e.id);
    out.push({
      id:            rawId || `idx_${index}`,
      label,
      listTitle,
      categoryLabel: trimmedString(e.category_label) || null,
      hints,
      answer:        answer || null,
      // title = プレイヤー表示名のみ。internal_title は意図的に検索対象へ入れない。
      titleTerms:    toTerms([label, listTitle]),
      aliasTerms:    toTerms(e.aliases),
      keywordTerms:  toTerms(e.keywords),
      index,
    });
  });
  return out;
}

/** 1 トークンに対する 1 ヒントのスコア。0 なら未ヒット。 */
function scoreToken(entry: NormalizedHintSearchEntry, token: string): number {
  if (entry.titleTerms.includes(token))   return SCORE.titleExact;
  if (entry.aliasTerms.includes(token))   return SCORE.aliasExact;
  if (entry.keywordTerms.includes(token)) return SCORE.keywordExact;
  if (entry.titleTerms.some((t) => t.includes(token))) return SCORE.titlePartial;
  if (entry.aliasTerms.some((t) => t.includes(token)) ||
      entry.keywordTerms.some((t) => t.includes(token))) return SCORE.termPartial;
  return 0;
}

/**
 * 登録済みヒントからのみ検索する。
 *
 * 複数トークンは OR でヒット判定し、「ヒットしたトークン数 → 合計スコア → 登録順」で
 * 並べる。つまり "机 キーボード" の両方に当たるヒントが、片方だけのヒントより上に来る。
 */
export function searchHintEntries(
  entries: NormalizedHintSearchEntry[],
  rawQuery: string,
): HintSearchMatch[] {
  const tokens = tokenizeHintSearchQuery(rawQuery);
  if (tokens.length === 0) return [];
  const matches: HintSearchMatch[] = [];
  for (const entry of entries) {
    let score = 0;
    let matchedTokens = 0;
    for (const token of tokens) {
      const s = scoreToken(entry, token);
      if (s > 0) { score += s; matchedTokens += 1; }
    }
    if (matchedTokens > 0) matches.push({ entry, score, matchedTokens });
  }
  matches.sort((a, b) => {
    if (a.matchedTokens !== b.matchedTokens) return b.matchedTokens - a.matchedTokens;
    if (a.score !== b.score) return b.score - a.score;
    return a.entry.index - b.entry.index;
  });
  return matches.slice(0, HINT_SEARCH_MAX_RESULTS);
}

// ── 「キーワードがわからない場合」の質問ツリー ───────────────────

/** 正規化済みの質問ツリー 1 ノード。 */
export interface NormalizedGuideNode {
  label:    string;
  /** 子選択肢を出すときの質問文。未設定なら既定文言を使う。 */
  question: string | null;
  options:  NormalizedGuideNode[];
  /** 葉のときに紐づく hint id。 */
  hintId:   string | null;
}

/** settings_json.hint_search_guide_options を正規化する。label が空のノードは落とす。
 *  子も葉の紐づけ（hint_id）も無いノードは行き止まりなので落とす。 */
export function normalizeHintSearchGuide(raw: unknown, depth = 1): NormalizedGuideNode[] {
  if (!Array.isArray(raw) || depth > HINT_SEARCH_GUIDE_MAX_DEPTH) return [];
  const out: NormalizedGuideNode[] = [];
  for (const item of raw.slice(0, HINT_SEARCH_GUIDE_MAX_OPTIONS)) {
    if (!item || typeof item !== "object") continue;
    const n = item as HintSearchGuideNode;
    const label = trimmedString(n.label);
    if (!label) continue;
    const options = normalizeHintSearchGuide(n.options, depth + 1);
    const hintId  = trimmedString(n.hint_id) || null;
    if (options.length === 0 && !hintId) continue; // 行き止まりの選択肢は出さない
    out.push({ label, question: trimmedString(n.question) || null, options, hintId });
  }
  return out;
}

export interface GuideResolution {
  /** これまでに選んだ選択肢のラベル（パンくず表示用）。 */
  breadcrumb: string[];
  /** 現在地のノード。ルート（path=[]）のときは null。 */
  node: NormalizedGuideNode | null;
  /** path が不正（存在しない選択肢）なら false。 */
  ok: boolean;
}

/** 選択肢のインデックス列から現在地を解決する。 */
export function resolveGuidePath(root: NormalizedGuideNode[], path: number[]): GuideResolution {
  const breadcrumb: string[] = [];
  let options = root;
  let node: NormalizedGuideNode | null = null;
  for (const idx of path) {
    const next: NormalizedGuideNode | undefined = options[idx];
    if (!next) return { breadcrumb, node, ok: false };
    breadcrumb.push(next.label);
    node = next;
    options = next.options;
  }
  return { breadcrumb, node, ok: true };
}

// ── プレイヤーへ返す DTO ───────────────────────────────────────
// ネタバレ防止のため、検索結果には「表示に必要な最小限」しか含めない。
// 本文 (hints) は詳細 API / 1 件ヒット時にだけ返す。

/** 検索結果 / 一覧の 1 行。本文は含まない。 */
export interface HintSearchResultItem {
  id:    string;
  label: string;
}

/** ヒント詳細。段階ヒントの本文を含む。 */
export interface HintSearchDetail {
  id:            string;
  label:         string;
  /** ヒント一覧（開封済み）に出す名称。開封履歴の保存に使う。 */
  listTitle:     string;
  categoryLabel: string | null;
  hints:         HintSearchHintLevel[];
  /** 答えの有無。本文は answer API で別途取得する（誤って先に配らないため）。 */
  hasAnswer:     boolean;
}

export function toResultItem(entry: NormalizedHintSearchEntry): HintSearchResultItem {
  return { id: entry.id, label: entry.label };
}

export function toDetail(entry: NormalizedHintSearchEntry): HintSearchDetail {
  return {
    id:            entry.id,
    label:         entry.label,
    listTitle:     entry.listTitle,
    categoryLabel: entry.categoryLabel,
    hints:         entry.hints,
    hasAnswer:     entry.answer !== null,
  };
}
