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
//
// ── 照合モードの意味（重要）────────────────────────────────
//   exact  : 厳密一致。従来どおり NFKC + trim（+任意で句読点除去）した上で
//            完全一致のみ正解。既存の exact パズルの挙動は一切変えない。
//   partial: 「部分一致を許容」トグル。自然文入力（「答えは〇〇です」等）や
//            答えの核心部分だけの入力を許容する。判定は以下の 3 段階：
//              1. 完全一致       normInput === normCandidate
//              2. 完全包含       normInput が normCandidate を丸ごと含む
//              3. 部分一致       答えの長さに応じた「連続文字列」の一致率で許容
//            partial では回答照合専用の強い正規化（小文字化・空白/記号除去）を
//            常に適用する（＝ ignore_punctuation 相当は常時 ON）。これは従来の
//            partial（includes のみ）に対して「受理を追加するだけ」で、既存に
//            受理されていた入力を落とすことはない。
//
// ── 部分一致（3.）の許容ルール ──────────────────────────────
//   正解候補の正規化後文字数 | 条件
//   ------------------------|--------------------------------------------
//   1〜4文字                | 部分一致は許容しない（完全包含のみ正解）
//   5〜7文字                | 正解候補の 80% 以上の「連続文字列」が入力に含まれる
//   8文字以上               | 正解候補の 50% 以上の「連続文字列」が入力に含まれる
//   ※「連続文字列」= 答えの連続部分文字列。非連続の寄せ集めは一致とみなさない。
//   ※別解・許容回答も候補ごとに同じ規則で判定する。短い別解（1〜4文字）は
//     自動的に完全包含のみとなり、ゆるすぎる誤判定を避ける。

export const ANSWER_MATCH_TYPES = [
  "exact",
  "partial",
  "normalize_width",
  "ignore_punctuation",
] as const;
export type AnswerMatchType = (typeof ANSWER_MATCH_TYPES)[number];

// 既存 webhook ロジックと同じ句読点クラス。CJK 記号・読点・全角スペース等を含む。
// exact モードの ignore_punctuation でのみ使用する（挙動を変えないため据え置き）。
const PUNCT_RE = /[!?,.　 \t、。，．・：；！？…‥〜ー　-〿]+/gu;

export function removePunct(s: string): string {
  return s.replace(PUNCT_RE, "").trim();
}

// exact モード用の正規化（従来どおり）。NFKC + trim のみ。
export function normalizePuzzleText(s: string): string {
  return s.trim().normalize("NFKC");
}

// ── partial（回答照合）専用の強い正規化 ──────────────────────
// 除去対象:
//   - 空白全般（半角/全角スペース・タブ・改行）… \s（u フラグは U+3000 も含む）
//   - ASCII 記号全域（! " # … / : ; < = > ? @ [ \ ] ^ _ ` { | } ~）
//   - CJK 句読点・括弧・中黒・長音符（、。・「」（）ー 等）
// 残すもの: 日本語（かな/カナ/漢字）・英字・数字（＝答えの核心）。
// 順序: NFKC（全角→半角の吸収）→ 小文字化 → 記号/空白除去。
// 注: 漢字↔かなの読み変換は行わない（別解・許容回答リスト側で対応する想定）。
const ANSWER_STRIP_RE =
  /[\s!-/:-@[-`{-~、。，．・：；！？…‥〜「」『』（）【】〔〕〈〉《》｡｢｣､･ー]/gu;

export function normalizePuzzleAnswerText(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(ANSWER_STRIP_RE, "")
    .trim();
}

/**
 * 2 つの文字列の「最長共通連続部分文字列（longest common substring）」の長さを返す。
 * 部分一致率の判定に使う。非連続の寄せ集めは数えない（連続一致のみ）。
 * 引数は正規化済みを想定するが、生文字列でも動作する。
 * 注: 文字は UTF-16 code unit 単位で比較する（BMP 内の日本語/英数字は 1 文字＝1 unit）。
 */
export function getLongestContiguousOverlapLength(a: string, b: string): number {
  if (!a || !b) return 0;
  const n = a.length;
  const m = b.length;
  let best = 0;
  // ローリング DP（前の行のみ保持）。dp[j] = a[..i] と b[..j] の末尾一致長。
  let prev = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const curr = new Array<number>(m + 1).fill(0);
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > best) best = curr[j];
      }
    }
    prev = curr;
  }
  return best;
}

/** 部分一致（連続一致率）の必要率を答えの正規化後文字数から返す。
 *  1〜4文字は部分一致を許容しない（null）。 */
function partialRatioThreshold(answerLen: number): number | null {
  if (answerLen <= 4) return null; // 完全包含のみ
  if (answerLen <= 7) return 0.8; // 5〜7文字 → 80%
  return 0.5; // 8文字以上 → 50%
}

export type PuzzleAnswerReason = "exact" | "inclusion" | "partial";

export interface PuzzleAnswerJudgement {
  /** いずれかの候補で正解条件を満たしたか */
  accepted: boolean;
  /** 正解になった理由（デバッグ・ログ用）。不正解時は null。 */
  reason: PuzzleAnswerReason | null;
  /** 正解の根拠になった候補（生の候補文字列）。不正解時は null。 */
  matchedCandidate: string | null;
}

const NOT_ACCEPTED: PuzzleAnswerJudgement = {
  accepted: false,
  reason: null,
  matchedCandidate: null,
};

/** 正規化済みの入力 1 件 × 候補 1 件を判定し、正解理由を返す（不一致は null）。 */
function judgeOneCandidate(
  normInput: string,
  normCandidate: string,
): PuzzleAnswerReason | null {
  if (!normInput || !normCandidate) return null;
  // 1. 完全一致
  if (normInput === normCandidate) return "exact";
  // 2. 完全包含
  if (normInput.includes(normCandidate)) return "inclusion";
  // 3. 部分一致（連続一致率）
  const threshold = partialRatioThreshold(normCandidate.length);
  if (threshold === null) return null; // 1〜4文字は完全包含のみ
  const overlap = getLongestContiguousOverlapLength(normInput, normCandidate);
  if (overlap / normCandidate.length >= threshold) return "partial";
  return null;
}

/**
 * partial（部分一致許容）ルールで、入力が複数正解候補のいずれかを満たすか判定する。
 * 完全一致 / 完全包含 / 部分一致（長さ別の連続一致率）のどの理由で正解になったかを返す。
 * 純関数（matchTypes 非依存・常に partial ルール）。仕様の中核。
 */
export function judgePuzzleAnswer(
  userInput: string,
  answerCandidates: string[],
): PuzzleAnswerJudgement {
  const normInput = normalizePuzzleAnswerText(userInput ?? "");
  if (!normInput || answerCandidates.length === 0) return NOT_ACCEPTED;
  for (const candidate of answerCandidates) {
    const normCandidate = normalizePuzzleAnswerText(candidate ?? "");
    if (!normCandidate) continue;
    const reason = judgeOneCandidate(normInput, normCandidate);
    if (reason) return { accepted: true, reason, matchedCandidate: candidate };
  }
  return NOT_ACCEPTED;
}

/**
 * 仕様のエントリポイント（boolean 版）。partial ルールで正解なら true。
 * 完全一致 / 完全包含 / 部分一致のいずれかを満たせば true。
 */
export function isPuzzleAnswerAccepted(
  userInput: string,
  answerCandidates: string[],
): boolean {
  return judgePuzzleAnswer(userInput, answerCandidates).accepted;
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

/** exact モードの厳密一致判定（従来ロジックを切り出し。挙動不変）。 */
function checkPuzzleAnswerExact(
  input: string,
  answer: string,
  matchTypes: string[],
): boolean {
  let normInput = normalizePuzzleText(input);
  let normAnswer = normalizePuzzleText(answer);
  if (!normInput || !normAnswer) return false;

  if (matchTypes.includes("ignore_punctuation")) {
    normInput = removePunct(normInput);
    normAnswer = removePunct(normAnswer);
    if (!normInput || !normAnswer) return false;
  }
  return normInput === normAnswer;
}

/**
 * matchTypes を考慮して複数候補を判定し、正解理由付きで返す。
 * webhook / preview のログや解析でどの理由で正解になったかを知りたい場合に使う。
 *   - "partial" 指定時: judgePuzzleAnswer（完全一致/完全包含/部分一致）
 *   - それ以外（exact）: 従来の厳密一致のみ（reason は "exact"）
 */
export function judgePuzzleAnswerAny(
  input: string,
  candidates: string[],
  matchTypes: string[],
): PuzzleAnswerJudgement {
  if (!input || candidates.length === 0) return NOT_ACCEPTED;
  if (matchTypes.includes("partial")) {
    return judgePuzzleAnswer(input, candidates);
  }
  // exact モード（従来・厳密一致）
  for (const candidate of candidates) {
    if (candidate && checkPuzzleAnswerExact(input, candidate, matchTypes)) {
      return { accepted: true, reason: "exact", matchedCandidate: candidate };
    }
  }
  return NOT_ACCEPTED;
}

/**
 * 入力テキストとパズルの答えを matchTypes に基づいて照合する（単一候補・boolean）。
 *
 * 仕様：
 *   - "partial" 指定時: 完全一致 / 完全包含 / 部分一致（長さ別の連続一致率）
 *     を回答照合専用の強い正規化で判定する。
 *   - それ以外（exact）: 従来どおり NFKC + trim（+任意で句読点除去）の完全一致。
 *   - 答え or 入力が空文字の場合は常に false。
 */
export function checkPuzzleAnswer(
  input: string,
  answer: string,
  matchTypes: string[],
): boolean {
  if (!input || !answer) return false;
  return judgePuzzleAnswerAny(input, [answer], matchTypes).accepted;
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
  return judgePuzzleAnswerAny(input, candidates, matchTypes).accepted;
}
