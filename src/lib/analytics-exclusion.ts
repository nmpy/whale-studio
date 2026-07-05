// src/lib/analytics-exclusion.ts
//
// 分析除外ユーザー（AnalyticsExcludedUser）を集計へ適用する純ヘルパー。
//   - 除外は OA 単位の lineUserId 集合。集計前に in-memory で除外する（元データは削除しない）。
//   - 期間フィルター / isPreview 除外とは独立して合成できる。
//   - UI 表示用の UID マスクもここに集約。

/** LINE UID を一部マスク（末尾4桁のみ表示）。 */
export function maskLineUserId(id: string): string {
  if (!id) return "U***";
  if (id.length <= 4) return "U***";
  return `U***${id.slice(-4)}`;
}

/** 候補/一覧ラベル用に末尾 n 桁だけ表示（既定6桁・「...xxxxxx」）。UID はフル露出しない。 */
export function maskTail(id: string, n = 6): string {
  if (!id) return "...";
  return `...${id.length <= n ? id : id.slice(-n)}`;
}

/** 除外候補プレイヤー（プルダウン用）。 */
export interface PlayerCandidate {
  lineUserId:        string;
  displayName:       string | null;
  label:             string;        // 「{表示名}（...末尾）」/「名前未取得（...末尾）」
  maskedLineUserId:  string;        // 「...末尾6桁」
  isAlreadyExcluded: boolean;
  lastActiveAt:      string | null; // ISO
}

/**
 * OA配下プレイヤー行（lineUserId + 最終アクティブ）から除外候補を組み立てる（純関数・非破壊）。
 *   - lineUserId が空の行は除外（fake は入れない）。重複 lineUserId は最初の1件に集約。
 *   - displayName は best-effort（無ければ null → ラベルは「名前未取得」）。
 *   - 既に除外済みは isAlreadyExcluded=true。
 *   - ソート: 表示名あり優先 → 最終アクティブ新しい順 → lineUserId 昇順（安定）。
 */
export function buildPlayerCandidates(
  rows: { lineUserId: string; lastActiveAt: Date | null }[],
  displayNameByUid: Map<string, string>,
  excludedSet: Set<string>,
): PlayerCandidate[] {
  const seen = new Set<string>();
  const out: PlayerCandidate[] = [];
  for (const r of rows) {
    const uid = (r.lineUserId ?? "").trim();
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    const name = displayNameByUid.get(uid)?.trim() || null;
    const masked = maskTail(uid);
    out.push({
      lineUserId:        uid,
      displayName:       name,
      label:             `${name ?? "名前未取得"}（${masked}）`,
      maskedLineUserId:  masked,
      isAlreadyExcluded: excludedSet.has(uid),
      lastActiveAt:      r.lastActiveAt ? r.lastActiveAt.toISOString() : null,
    });
  }
  out.sort((a, b) => {
    const an = a.displayName ? 0 : 1, bn = b.displayName ? 0 : 1;
    if (an !== bn) return an - bn;
    const at = a.lastActiveAt ? Date.parse(a.lastActiveAt) : 0;
    const bt = b.lastActiveAt ? Date.parse(b.lastActiveAt) : 0;
    if (at !== bt) return bt - at;
    return a.lineUserId.localeCompare(b.lineUserId);
  });
  return out;
}

/**
 * 除外対象 lineUserId を集計対象リストから取り除く（非破壊）。
 * excluded が空なら元配列をそのまま返す。
 */
export function applyExclusion<T extends { lineUserId: string }>(list: T[], excluded: Set<string>): T[] {
  if (excluded.size === 0) return list;
  return list.filter((p) => !excluded.has(p.lineUserId));
}
