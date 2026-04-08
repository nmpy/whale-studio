// src/lib/user-display.ts
// ユーザー表示名のフォールバック付き取得

/**
 * profile から表示名を取得する。
 * username が空・null・undefined の場合は「ユーザー」を返す。
 */
export function getDisplayName(profile?: { username?: string | null } | null): string {
  return profile?.username?.trim() || "ユーザー";
}
