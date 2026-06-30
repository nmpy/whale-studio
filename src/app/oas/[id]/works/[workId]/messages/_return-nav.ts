// src/app/oas/[id]/works/[workId]/messages/_return-nav.ts
// メッセージ作成/編集の「元タブへ戻る」ナビゲーション補助（純ロジック）。
// 戻り先の優先順位: returnTo(同一アプリ相対パスのみ許可) > returnTab(?tab= 付与) > デフォルト一覧。

/**
 * タブトークンとして安全か。
 * 取りうる値は "all" / "__unassigned" / フェーズ UUID（[0-9a-f-]）。
 * スラッシュ・空白・制御文字を含む値は弾く（URL 破壊・インジェクション防止）。
 */
export function isSafeTabToken(raw: string | null | undefined): raw is string {
  return typeof raw === "string" && raw.length > 0 && raw.length <= 64 && /^[A-Za-z0-9_-]+$/.test(raw);
}

/**
 * returnTo を同一アプリ内の相対パスに限定する。
 * 外部 URL / protocol-relative(//) / スキーム(://) / バックスラッシュ / 制御文字は拒否。
 * 安全でなければ null。
 */
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (!raw.startsWith("/")) return null;              // 絶対 http(s):// や ./ 相対を排除
  if (raw.startsWith("//")) return null;              // protocol-relative
  if (raw.includes("://") || raw.includes("\\")) return null;
  if (raw.includes("\n") || raw.includes("\r") || raw.includes("\t")) return null; // 制御文字
  return raw;
}

/** 一覧へ戻る href を組み立てる。returnTo 優先 → returnTab(?tab=) → base。 */
export function buildMessagesReturnHref(
  base: string,
  opts: { returnTo?: string | null; returnTab?: string | null },
): string {
  const to = safeReturnTo(opts.returnTo);
  if (to) return to;
  if (isSafeTabToken(opts.returnTab)) return `${base}?tab=${encodeURIComponent(opts.returnTab)}`;
  return base;
}

/** 作成/編集画面の href に現在タブを returnTab として付与する。 */
export function withReturnTab(targetHref: string, currentTab: string | null | undefined): string {
  if (!isSafeTabToken(currentTab)) return targetHref;
  const sep = targetHref.includes("?") ? "&" : "?";
  return `${targetHref}${sep}returnTab=${encodeURIComponent(currentTab)}`;
}
