// src/lib/start-keyword.ts
//
// 「1つの OA に複数作品を公開し、開始キーワードで別作品を開始する」機能の純ロジック。
// LINE webhook（開始判定）と管理画面（重複バリデーション）の両方が同じ正規化・照合を使うため集約する。
//
// 開始キーワード候補 = Work.startKeyword（新規）∨ 該当作品の開始フェーズ Phase.startTrigger（既存・あいさつ開始QR互換）。
// 正規化後、同一 OA の公開中作品間で重複してはならない（重複時は曖昧なので開始しない / 保存時はエラー）。
//
// 注: MVP は 1 作品 1 startKeyword。将来の複数キーワード対応に備え、照合は候補配列ベースにしてある。

/** 開始キーワードの正規化: trim + NFKC + 小文字化（日本語は不変・前後/連続スペースを単一化）。空は ""。 */
export function normalizeStartKeyword(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  // NFKC で全角英数等を統一 → 連続空白を1つに → trim → 小文字化（ASCII等のみ作用・日本語は不変）。
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 開始判定対象の作品（候補キーワードの素となるフィールド）。 */
export type StartWorkCandidate = {
  id:           string;
  startKeyword?: string | null;
  /** 開始フェーズ Phase.startTrigger（あいさつ開始クイックリプライ互換）。途中フェーズの応答トリガーは含めない。 */
  startTrigger?: string | null;
};

/** 1 作品の開始キーワード候補（正規化済み・空除外・重複除外）。 */
export function startKeywordsOf(work: StartWorkCandidate): string[] {
  const out: string[] = [];
  for (const raw of [work.startKeyword, work.startTrigger]) {
    const n = normalizeStartKeyword(raw);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * 受信テキストに一致する作品を1つ返す。
 *   - 正規化テキストが、ある作品の候補キーワードと完全一致したら、その作品。
 *   - 複数作品に一致（＝重複キーワード）したら曖昧なので null（安全側で開始しない）。
 *   - どれにも一致しなければ null。
 */
export function matchStartWork(
  text: string,
  works: StartWorkCandidate[],
): StartWorkCandidate | null {
  const t = normalizeStartKeyword(text);
  if (!t) return null;
  const matched = works.filter((w) => startKeywordsOf(w).includes(t));
  return matched.length === 1 ? matched[0] : null;
}

/**
 * 同一 OA の公開中作品集合の中で、開始キーワード候補（startKeyword ∨ startTrigger）が
 * 重複している正規化キーワードを返す（重複なしなら空配列）。管理画面の保存/公開バリデーション用。
 */
export function findStartKeywordConflicts(works: StartWorkCandidate[]): string[] {
  const seen = new Map<string, number>();
  for (const w of works) {
    for (const k of startKeywordsOf(w)) {
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

/**
 * 対象作品 target の開始キーワード（candidateKeyword）が、同一 OA の他の公開中作品の
 * 候補キーワードと衝突するか。管理画面で 1 作品の startKeyword を保存する際の判定に使う。
 *   - others は target 以外の公開中作品（startKeyword / startTrigger 付き）。
 *   - candidateKeyword 空なら衝突なし（未設定は許容）。
 */
export function conflictsWithOthers(
  candidateKeyword: string | null | undefined,
  others: StartWorkCandidate[],
): boolean {
  const k = normalizeStartKeyword(candidateKeyword);
  if (!k) return false;
  return others.some((w) => startKeywordsOf(w).includes(k));
}

// ── 「自由入力で開始」(startTriggerMode="free_text") の解決 ────────────────────

/** free_text 開始の候補（active 作品）。id と開始方法のみで判定する（純関数用）。 */
export interface FreeTextStartCandidate {
  id: string;
  startTriggerMode?: string | null;
}

/** free_text 開始の解決結果。start=対象1件 / ambiguous=複数で開始不可 / none=対象なし。 */
export type FreeTextStartResolution =
  | { status: "start";     workId:  string }
  | { status: "ambiguous"; workIds: string[] }
  | { status: "none" };

/**
 * 同一 OA の公開中作品から free_text 開始対象を解決する（純関数・副作用なし）。
 *   - startTriggerMode="free_text" の作品がちょうど1件 → start（その作品）
 *   - 2件以上 → ambiguous（曖昧なので開始しない・ログ用に workIds を返す）
 *   - 0件 → none
 * ※ 呼び出し側で「進行中 progress が無い」「開始キーワードに非一致」を先に確認すること。
 */
export function resolveFreeTextStartWork(works: FreeTextStartCandidate[]): FreeTextStartResolution {
  const ft = works.filter((w) => w.startTriggerMode === "free_text");
  if (ft.length === 1) return { status: "start", workId: ft[0].id };
  if (ft.length >= 2)  return { status: "ambiguous", workIds: ft.map((w) => w.id) };
  return { status: "none" };
}
