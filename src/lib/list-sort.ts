// src/lib/list-sort.ts
//
// 一覧（アカウント一覧 / 作品一覧 等）の「日時ソート」共通ヘルパー（純関数・副作用なし）。
//   - 表示している日時と同じ値で比較する（表示 = ソート基準を一致させる）。
//   - 文字列比較ではなく必ず Date(epoch ms) に変換して比較する。
//   - null / undefined / 不正な日時は、desc / asc いずれでも常に末尾に送る。
//   - 同値のときは呼び出し側で id 等の安定 tie-break を行う前提（この関数は 0 を返す）。

/** ISO 文字列（null/undefined/不正可）→ epoch ms。無効なら null。 */
export function toTimeMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * 日時比較。dir="desc" は新しい順、"asc" は古い順。
 * null / 無効な日時は dir に関わらず常に末尾（正の値を返す）。両方 null / 同値は 0。
 */
export function compareByTime(a: number | null, b: number | null, dir: "desc" | "asc"): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;   // a を後ろへ
  if (b === null) return -1;  // b を後ろへ
  return dir === "desc" ? b - a : a - b;
}

type Dated = { updated_at?: string | null; created_at?: string | null };

/**
 * 表示している「更新日時（updated_at ?? created_at）」で比較する。
 * カードの更新日時表示が `updated_at ?? created_at` のとき、ソート基準を表示と一致させるために使う。
 * dir 既定は "desc"（最終更新が新しい順）。null/無効は末尾。
 */
export function compareByUpdatedThenCreated(a: Dated, b: Dated, dir: "desc" | "asc" = "desc"): number {
  return compareByTime(toTimeMs(a.updated_at ?? a.created_at), toTimeMs(b.updated_at ?? b.created_at), dir);
}

/** 作成日時（created_at）で比較する。dir 既定 "desc"。null/無効は末尾。 */
export function compareByCreated(a: { created_at?: string | null }, b: { created_at?: string | null }, dir: "desc" | "asc" = "desc"): number {
  return compareByTime(toTimeMs(a.created_at), toTimeMs(b.created_at), dir);
}

type Activity = { latest_activity_at?: string | null; updated_at?: string | null; created_at?: string | null };

/** 表示する「更新日時」＝配下の最新活動日時（latest_activity_at ?? updated_at ?? created_at）を返す。 */
export function activityTimeOf(x: Activity): number | null {
  return toTimeMs(x.latest_activity_at ?? x.updated_at ?? x.created_at);
}

/**
 * アカウント/作品一覧の「最終更新」ソート用比較。
 * 表示している更新日時（latest_activity_at ?? updated_at ?? created_at）で比較する（表示=ソート一致）。
 * dir 既定 "desc"（最終更新が新しい順）。null/無効は末尾。
 */
export function compareByLatestActivity(a: Activity, b: Activity, dir: "desc" | "asc" = "desc"): number {
  return compareByTime(activityTimeOf(a), activityTimeOf(b), dir);
}

/**
 * 最終更新（latest_activity_at ?? updated_at ?? created_at）が新しい順に並べる（非破壊）。
 * 同値は id で安定 tie-break（表示のちらつき防止）。アカウントカード内の作品行の並びに使う。
 */
export function sortByLatestActivity<T extends Activity & { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const c = compareByLatestActivity(a, b, "desc");
    return c !== 0 ? c : a.id.localeCompare(b.id);
  });
}
