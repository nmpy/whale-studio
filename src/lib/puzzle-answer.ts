// src/lib/puzzle-answer.ts
// 謎（puzzle）回答の照合ロジック共通モジュール。
//
// answer_match_type は配列で、以下の組み合わせを保持する：
//   - 照合条件（必須・どちらか1つ）: "exact" | "partial"
//   - 正規化オプション（任意・複数可）: "normalize_width" | "ignore_punctuation"
//
// 既存データとの互換性のため、配列に "partial" が含まれていなければ "exact"
// として扱う。NFKC 正規化は常に適用するため "normalize_width" は実質的に
// no-op だが、UI のチェック状態保持用として配列に残す。
//
// webhook / runtime / preview / CMS など、回答判定を行うすべての経路から
// この関数を利用すること。

export const ANSWER_MATCH_TYPES = [
  "exact",
  "partial",
  "normalize_width",
  "ignore_punctuation",
] as const;
export type AnswerMatchType = (typeof ANSWER_MATCH_TYPES)[number];

// 既存 webhook ロジックと同じ句読点クラス。CJK 記号・読点・全角スペース等を含む。
const PUNCT_RE = /[!?,.　 \t、。，．・：；！？…‥〜ー　-〿]+/gu;

export function removePunct(s: string): string {
  return s.replace(PUNCT_RE, "").trim();
}

export function normalizePuzzleText(s: string): string {
  return s.trim().normalize("NFKC");
}

/**
 * DB に文字列で保存された answer_match_type を string[] に変換する。
 * 既存データ（null / 不正な JSON）は ["exact"] として扱う。
 */
export function parseAnswerMatchType(
  raw: string | string[] | null | undefined,
): string[] {
  if (Array.isArray(raw)) {
    return raw.length > 0 ? raw : ["exact"];
  }
  if (!raw) return ["exact"];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    /* fallthrough */
  }
  return ["exact"];
}

/**
 * 入力テキストとパズルの答えを matchTypes に基づいて照合する。
 *
 * 仕様：
 *   - 双方を NFKC 正規化＋trim する
 *   - "ignore_punctuation" 指定時は句読点・記号を除去
 *   - "partial" を含む場合は includes 判定、それ以外は完全一致
 *   - 答え or 入力が空文字の場合は常に false
 */
export function checkPuzzleAnswer(
  input: string,
  answer: string,
  matchTypes: string[],
): boolean {
  if (!input || !answer) return false;

  let normInput = normalizePuzzleText(input);
  let normAnswer = normalizePuzzleText(answer);
  if (!normInput || !normAnswer) return false;

  if (matchTypes.includes("ignore_punctuation")) {
    normInput = removePunct(normInput);
    normAnswer = removePunct(normAnswer);
    if (!normInput || !normAnswer) return false;
  }

  if (matchTypes.includes("partial")) {
    return normInput.includes(normAnswer);
  }
  return normInput === normAnswer;
}
