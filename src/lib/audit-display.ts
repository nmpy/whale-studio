// src/lib/audit-display.ts
// 操作ログ（AdminAuditLog）の表示用ヘルパー（純ロジック・no JSX → node テスト可）。
//
// - actorId（Supabase Auth userId）は Profile.userId と join して表示名を解決する。
// - 画面に UUID / 内部 ID は出さない。紐づく Profile が無い古いログは「不明」。
// - resource（内部キー）は管理者向けの日本語表示名へマッピング（未定義は元値フォールバック）。

/** Profile から操作者の表示名を解決する。優先: username → 姓名 → 不明。
 *  （Profile に email は無いため email フォールバックは対象外。username は NOT NULL。） */
export function resolveAuditActorName(
  profile?: { username?: string | null; firstName?: string | null; lastName?: string | null } | null,
): string {
  if (!profile) return "不明";
  const username = profile.username?.trim();
  if (username) return username;
  const fullName = [profile.lastName, profile.firstName]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  if (fullName) return fullName;
  return "不明";
}

/** resource（内部キー）→ 管理者向け日本語表示名。 */
export const AUDIT_RESOURCE_LABEL: Record<string, string> = {
  announcement:    "お知らせ管理",
  document:        "ドキュメント",
  oa:              "OA",
  member:          "メンバー",
  user:            "ユーザー",
  personal_plan:   "プラン権限",
  plan_permission: "プラン権限",
  business_invite: "招待URL発行",
  oa_review:       "OA連携審査",
  audit:           "操作ログ",
};

/** resource を日本語表示名へ。未定義キーは壊さず元の値をそのまま返す。 */
export function auditResourceLabel(resource: string | null | undefined): string {
  if (!resource) return "—";
  return AUDIT_RESOURCE_LABEL[resource] ?? resource;
}
