// src/lib/studio-invite-ui.ts
// 統合「招待URL発行」UI と server の双方で使う「クライアント安全」な純ロジック/定数。
// node:crypto を import しないため、client component からも安全に取り込める
// （studio-invite.ts は node:crypto を使うため client から import 不可）。

/** 発行可能なロール (= owner は URL 招待で配らない / member-invite と同方針)。 */
export const STUDIO_INVITE_ROLES = ["admin", "editor", "tester", "viewer"] as const;

/** 発行可能なプランティア (= PlanTier。課金非連動の grant snapshot)。 */
export const STUDIO_INVITE_PLAN_TIERS = ["basic", "standard", "plus", "pro", "delegated"] as const;

/** 招待アクション区分(統合招待UI 用)。 */
export const STUDIO_INVITE_ACTIONS = [
  // 個人
  "register_user", "member_invite", "register_and_member",
  // 法人(business OA)
  "corp_register", "corp_admin_invite", "corp_register_admin",
  "corp_oa_link", "corp_register_admin_oa",
] as const;
export type StudioInviteAction = (typeof STUDIO_INVITE_ACTIONS)[number];

/** 使用上限の上限値(暴発防止)。既定 1。 */
export const STUDIO_INVITE_MAX_USES_LIMIT = 100;

/** 招待URLの有効期限の既定値 (= 発行から 7 日)。UI 未指定時はこの日数。 */
export const STUDIO_INVITE_EXPIRES_IN_DAYS = 7;
/** 有効期限として選べる最大日数 (暴発防止)。 */
export const STUDIO_INVITE_MAX_EXPIRES_DAYS = 90;
/** UI のプルダウン候補 (日数)。 */
export const STUDIO_INVITE_EXPIRES_OPTIONS = [1, 3, 7, 14, 30, 60, 90] as const;

// ── 個人/法人 × 招待内容 ─────────────────────────────────
export type InviteScope = "personal" | "business";

/** scope → Oa.usageType（個人=personal / 法人=business）。 */
export function scopeUsageType(scope: InviteScope): "personal" | "business" {
  return scope === "business" ? "business" : "personal";
}

// ── このUIで「安全に動く」招待内容のみ ───────────────────────────
// 重要: StudioInvite.oaId は必須・受諾は「既存OAへ usageType/role/plan を反映」のみ。
//   よって OA作成 / 新規ユーザー登録 / OA-less 発行（register_user / register_and_member /
//   corp_register / corp_register_admin / corp_register_admin_oa）は受諾未対応のため UI では出さない。
//   既存OAへの招待（member_invite / corp_oa_link / corp_admin_invite）のみ表示する。
//   ※ DB/API 値（STUDIO_INVITE_ACTIONS）は互換のため残す（UI から選べないだけ）。

/** UI から選べる招待内容（個人/法人）。member/admin は role を既定セットするだけで inviteAction は既存値。 */
export type UnifiedInviteOption = { key: string; label: string; inviteAction: StudioInviteAction; defaultRole: typeof STUDIO_INVITE_ROLES[number] };
export const UNIFIED_INVITE_OPTIONS: Record<InviteScope, UnifiedInviteOption[]> = {
  personal: [
    { key: "personal_member", label: "既存個人OAへのメンバー招待", inviteAction: "member_invite", defaultRole: "viewer" },
    { key: "personal_admin",  label: "既存個人OAへの管理者招待",   inviteAction: "member_invite", defaultRole: "admin" },
  ],
  business: [
    { key: "business_member", label: "既存法人OAへのメンバー招待", inviteAction: "corp_oa_link",     defaultRole: "viewer" },
    { key: "business_admin",  label: "既存法人OAの管理者招待",     inviteAction: "corp_admin_invite", defaultRole: "admin" },
  ],
};

/** 各 scope で UI 表示する inviteAction 値（バリデーション/絞り込み用）。OA作成/登録系は含めない。 */
export const INVITE_ACTIONS_BY_SCOPE: Record<InviteScope, StudioInviteAction[]> = {
  personal: ["member_invite"],
  business: ["corp_oa_link", "corp_admin_invite"],
};

/** 招待内容の表示ラベル（一覧表示用）。UI で出すのは既存OA向けの3値。
 *  受諾未対応の値（OA作成/登録系）は誤解を避けるため中立表記にする（UI では選べない）。 */
export const INVITE_ACTION_LABELS: Record<StudioInviteAction, string> = {
  member_invite:           "既存OAへのメンバー招待",
  corp_oa_link:            "既存法人OAへのメンバー招待",
  corp_admin_invite:       "既存法人OAの管理者招待",
  // 以下は受諾未対応（このUIでは非表示）。旧/将来用に値だけ残す。
  register_user:           "（このUIでは非対応）",
  register_and_member:     "（このUIでは非対応）",
  corp_register:           "（このUIでは非対応）",
  corp_register_admin:     "（このUIでは非対応）",
  corp_register_admin_oa:  "（このUIでは非対応）",
};

/** その招待内容で「権限(role)」の指定が必須か。既存OAへの招待はすべて必須。 */
export function inviteActionRequiresRole(action: StudioInviteAction): boolean {
  return action !== "register_user" && action !== "corp_register";
}

// 招待状態。"accepted" = 単発URL使用済み / "used_up" = 複数回URLが上限到達。
export type StudioInviteState = "active" | "accepted" | "used_up" | "expired" | "revoked" | "none";

/**
 * 招待レコードの状態を判定する（純関数・client/server 共通）。
 *   優先順: none > revoked(=disabled) > accepted(単発使用済み) > expired > used_up(上限到達) > active
 * 後方互換: maxUses/usedCount 省略時は単発(1/0)。旧データ(maxUses=1)は acceptedAt があれば "accepted"。
 *           複数回(maxUses>1)は usedCount >= maxUses で "used_up"。expiresAt は必須。
 */
export function studioInviteState(
  invite:
    | { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date; maxUses?: number | null; usedCount?: number | null }
    | null
    | undefined,
  now: Date = new Date(),
): StudioInviteState {
  if (!invite) return "none";
  if (invite.revokedAt) return "revoked";
  const max  = invite.maxUses ?? 1;
  const used = invite.usedCount ?? 0;
  if (max <= 1 && (invite.acceptedAt != null || used >= 1)) return "accepted";
  if (now > invite.expiresAt) return "expired";
  if (used >= max) return "used_up";
  return "active";
}
