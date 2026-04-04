/**
 * src/lib/constants/member-text.ts
 *
 * メンバー管理・権限・招待まわりのユーザー向け文言を一元管理するファイル。
 *
 * 使用箇所:
 *   - src/app/oas/[id]/settings/members/page.tsx
 *   - src/app/invite/[token]/page.tsx
 *   - src/app/access-denied/page.tsx
 *   - src/app/login/page.tsx
 *
 * ⚠ API 側のエラーメッセージ（route.ts 内の日本語文字列）はここに含まない。
 *   サーバーエラーはそのまま e.message でユーザーに表示される想定。
 */

// ────────────────────────────────────────────────────────────────────
// ステータス
// ────────────────────────────────────────────────────────────────────

/** メンバーステータスの表示ラベル */
export const STATUS_LABELS: Record<string, string> = {
  active:    "有効",
  inactive:  "一時停止中",
  suspended: "凍結",
};

/** ステータスセレクトの選択肢 */
export const STATUS_OPTIONS = [
  { value: "active",    label: "✅ 有効" },
  { value: "inactive",  label: "⏸ 一時停止中" },
  { value: "suspended", label: "🚫 凍結" },
] as const;

/** ステータスバッジのカラー */
export const STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  active:    { bg: "#dcfce7", color: "#166534", border: "#86efac" },
  inactive:  { bg: "#fef9c3", color: "#854d0e", border: "#fde047" },
  suspended: { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5" },
};

// ────────────────────────────────────────────────────────────────────
// 招待の状態
// ────────────────────────────────────────────────────────────────────

export const INVITATION_STATE_LABELS = {
  accepted: "承諾済み",
  expired:  "期限切れ",
  pending:  "招待中",
} as const;

// ────────────────────────────────────────────────────────────────────
// 確認ダイアログ（window.confirm）
// ────────────────────────────────────────────────────────────────────

export const CONFIRM = {
  roleChange: (name: string, roleLabel: string) =>
    `${name} のロールを「${roleLabel}」に変更しますか？`,

  statusChange: (name: string, statusLabel: string) =>
    `${name} のステータスを「${statusLabel}」に変更しますか？`,

  /** 凍結は強い警告ダイアログ */
  suspend: (name: string) =>
    `⚠️ 警告: ${name} を「凍結」しますか？\n\n` +
    `凍結すると、このユーザーはワークスペースへの\n` +
    `アクセスが即座にブロックされます。\n\n` +
    `解除するにはステータスを「有効」に戻してください。`,

  deleteMember: (name: string) =>
    `${name} をワークスペースから削除しますか？\nこの操作は取り消せません。`,

  revokeInvitation: (email: string) =>
    `${email} への招待を取り消しますか？`,
} as const;

// ────────────────────────────────────────────────────────────────────
// トースト通知
// ────────────────────────────────────────────────────────────────────

export const TOAST = {
  roleChanged:       "ロールを変更しました",
  statusChanged:     "ステータスを変更しました",
  memberDeleted:     "メンバーを削除しました",
  invitationRevoked: "招待を取り消しました",
  invitationCreated: "招待リンクを発行しました",
  linkCopied:        "リンクをコピーしました",

  // エラー系（サーバーメッセージを e.message で表示できない場合のフォールバック）
  roleChangeFailed:       "ロールの変更に失敗しました",
  statusChangeFailed:     "ステータスの変更に失敗しました",
  deleteFailed:           "メンバーの削除に失敗しました",
  revokeFailed:           "招待の取り消しに失敗しました",
  inviteFailed:           "招待の送信に失敗しました",
  membersLoadFailed:      "メンバーの読み込みに失敗しました",
  invitationsLoadFailed:  "招待一覧の読み込みに失敗しました",
} as const;

// ────────────────────────────────────────────────────────────────────
// ツールチップ（title 属性）
// ────────────────────────────────────────────────────────────────────

export const TOOLTIP = {
  selfRoleChange:       "自分のロールは変更できません",
  lastOwnerRoleChange:  "最後のオーナーのロールは変更できません",
  selfStatusChange:     "自分のステータスは変更できません",
  selfDelete:           "自分を削除することはできません",
  lastOwnerDelete:      "最後のオーナーは削除できません",
  deleteButton:         "メンバーを削除",
} as const;

// ────────────────────────────────────────────────────────────────────
// アクセス拒否画面（access-denied & login ページで共用）
// ────────────────────────────────────────────────────────────────────

export const ACCESS_DENIED_CONTENT = {
  inactive: {
    icon:     "⏸",
    title:    "メンバーシップが一時停止されています",
    body:     "このワークスペースへのアクセスは一時停止中です。管理者（admin / owner）にお問い合わせください。",
    canRetry: true,
  },
  suspended: {
    icon:     "🚫",
    title:    "アカウントが凍結されています",
    body:     "このアカウントは凍結されています。ワークスペースのオーナーにお問い合わせください。",
    canRetry: false,
  },
  forbidden: {
    icon:     "🔒",
    title:    "アクセス権がありません",
    body:     "このワークスペースへのアクセス権がありません。招待メールを受け取っていない場合はオーナーにご連絡ください。",
    canRetry: false,
  },
  default: {
    icon:     "⚠️",
    title:    "アクセスできません",
    body:     "このページへのアクセス権がありません。",
    canRetry: false,
  },
} as const;

export type AccessDeniedReason = keyof typeof ACCESS_DENIED_CONTENT;

// ────────────────────────────────────────────────────────────────────
// ログインページのアクセス拒否バナー（login page 専用の短縮版）
// ────────────────────────────────────────────────────────────────────

export const LOGIN_ERROR_BANNERS: Record<string, { title: string; body: string }> = {
  inactive: {
    title: ACCESS_DENIED_CONTENT.inactive.title,
    body:  ACCESS_DENIED_CONTENT.inactive.body,
  },
  suspended: {
    title: ACCESS_DENIED_CONTENT.suspended.title,
    body:  ACCESS_DENIED_CONTENT.suspended.body,
  },
  forbidden: {
    title: ACCESS_DENIED_CONTENT.forbidden.title,
    body:  "このワークスペースへのアクセス権がありません。招待をご確認ください。",
  },
};
