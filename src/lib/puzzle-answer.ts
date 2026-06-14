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

/**
 * DB に文字列で保存された複数正解 answers を string[] に変換する。
 * - 配列ならそのまま、JSON 文字列なら parse、null/不正は []。
 * - 前後空白を trim し、空文字は除外する（保存側でも除外するが念のため二重に）。
 */
export function parsePuzzleAnswers(
  raw: string | string[] | null | undefined,
): string[] {
  let arr: unknown;
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (!raw) {
    return [];
  } else {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 単一 answer（後方互換）と複数 answers を統合した正解候補配列を返す。
 * trim 済み・空除外・重複除外。判定・保存の双方から使う共通正規化。
 */
export function resolveAnswerCandidates(
  answer: string | null | undefined,
  answers: string | string[] | null | undefined,
): string[] {
  const list: string[] = [];
  const single = (answer ?? "").trim();
  if (single) list.push(single);
  list.push(...parsePuzzleAnswers(answers));
  // 重複除外（順序保持）
  return Array.from(new Set(list));
}

/**
 * 入力テキストが複数正解候補のいずれかに一致すれば true。
 * 候補が空なら false。各候補は checkPuzzleAnswer と同じ規則で照合する。
 */
export function checkPuzzleAnswerAny(
  input: string,
  candidates: string[],
  matchTypes: string[],
): boolean {
  if (!input || candidates.length === 0) return false;
  return candidates.some((a) => checkPuzzleAnswer(input, a, matchTypes));
}
