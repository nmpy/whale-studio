// src/lib/access-preview.ts
//
// owner 向けの「表示確認モード (= access preview)」を実現する helper 群。
//
// ## 目的
//
// owner が他プラン / 他 role の **見え方** を確認するために、
// 現在のセッションの plan / role 認識を一時的にオーバーライドする手段を提供する。
//
// ## 重要な制約
//
// - これは **UI 表示確認専用** であり、実 DB の Subscription.plan や workspaceMember.role を
//   変更しない。
// - owner 以外のユーザーは `?previewPlan` / `?previewRole` を query string に付けても **完全に無視**
//   される (= `canUsePreviewMode=false` のとき override は no-op)。
// - API 側は **絶対に preview を採用しない**。サーバの requirePlanFeature / requireRole は
//   常に **実プラン / 実 role** を使い続ける。preview で権限を「広げる」ことは仕様上できない。
// - 安全側: 不正な query 値は無視して real 値にフォールバックする。
//
// ## 状態保持方式
//
// query parameter (`?previewPlan=basic&previewRole=client_operator`) で持つ。
// 理由:
//   - URL 共有時に preview 状態を再現できる (= 「Basic で見るとこう」と URL を貼って共有)
//   - リロードで消えない / 副作用 (= localStorage) を作らない
//   - owner じゃないユーザーが query を持っていても判定で弾けば安全
//
// ## API 制限 (= 重要)
//
// このファイルは **client component / page guard 専用**。API ハンドラ
// (= `src/app/api/**/route.ts`) からは絶対に import しないこと。API では
// `requirePlanFeature` / `requireRole` (実プラン / 実 role) のみ使用する。

import { PLAN_TIER, type PlanTier } from "@/lib/constants/plans";

// ────────────────────────────────────────────────
// PreviewRole
// ────────────────────────────────────────────────

/** 表示確認用 role の値域 (= 将来の role 制御を見据えた集合)。
 *  既存の WorkspaceRole (= owner/admin/editor/tester/viewer) と異なる名前を含む。
 *  client_operator はけんぴちゃんのような外部クライアント運用者向けの将来 role。 */
export const PREVIEW_ROLE = {
  owner:           "owner",
  admin:           "admin",
  editor:          "editor",
  operator:        "operator",
  viewer:          "viewer",
  client_operator: "client_operator",
} as const;

/** PreviewRole 型 */
export type PreviewRole = typeof PREVIEW_ROLE[keyof typeof PREVIEW_ROLE];

/** PreviewRole の表示名 (= 日本語 UI 用) */
export const PREVIEW_ROLE_LABELS: Record<PreviewRole, string> = {
  owner:           "オーナー",
  admin:           "管理者",
  editor:          "編集者",
  operator:        "運用者",
  viewer:          "閲覧者",
  client_operator: "クライアント運用者",
};

/** PreviewRole の順序 (= UI 一覧表示の順番) */
export const PREVIEW_ROLE_ORDER: readonly PreviewRole[] = [
  "owner", "admin", "editor", "operator", "viewer", "client_operator",
];

// ────────────────────────────────────────────────
// 入力 normalize / validate
// ────────────────────────────────────────────────

/** query string から渡される値を PlanTier に安全に変換する。
 *  許可された値以外は null を返す (= preview 無効扱い)。 */
export function parsePreviewPlan(raw: string | null | undefined): PlanTier | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === PLAN_TIER.basic || v === PLAN_TIER.standard || v === PLAN_TIER.plus || v === PLAN_TIER.pro) {
    return v;
  }
  return null;
}

/** query string から渡される値を PreviewRole に安全に変換する。
 *  許可された値以外は null を返す。 */
export function parsePreviewRole(raw: string | null | undefined): PreviewRole | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (
    v === "owner" || v === "admin" || v === "editor" ||
    v === "operator" || v === "viewer" || v === "client_operator"
  ) {
    return v;
  }
  return null;
}

// ────────────────────────────────────────────────
// effective plan / role 決定
// ────────────────────────────────────────────────

/** 「実プラン」と「preview 指定」から、UI が使うべき plan を返す。
 *  - canUsePreviewMode=false (= owner 以外) は preview を完全に無視する
 *  - previewPlan が null / 不正値の場合も realPlan を返す
 *  - canUsePreviewMode=true かつ previewPlan が有効 → previewPlan を返す
 *
 *  この関数は **UI 専用**。API では絶対に呼ばないこと (= 権限が広がるため)。 */
export function getEffectivePlan(args: {
  realPlan: PlanTier;
  previewPlan: PlanTier | null;
  canUsePreviewMode: boolean;
}): PlanTier {
  if (!args.canUsePreviewMode) return args.realPlan;
  if (!args.previewPlan) return args.realPlan;
  return args.previewPlan;
}

/** 同上で role 版。WorkspaceRole は既存の owner/admin/editor/tester/viewer 集合だが、
 *  preview role は client_operator など将来の role も含むため別型 (= PreviewRole) で扱う。
 *
 *  - canUsePreviewMode=false → realRole を返す
 *  - previewRole が null / 不正値 → realRole を返す
 *  - そうでなければ previewRole を返す */
export function getEffectiveRole<R extends string | null>(args: {
  realRole: R;
  previewRole: PreviewRole | null;
  canUsePreviewMode: boolean;
}): R | PreviewRole {
  if (!args.canUsePreviewMode) return args.realRole;
  if (!args.previewRole) return args.realRole;
  return args.previewRole;
}

// ────────────────────────────────────────────────
// URL 構築 helper
// ────────────────────────────────────────────────

/** 現在の URL search params に previewPlan / previewRole を追加 / 解除した結果を返す。
 *  既存の他 query は保持する。値が null なら該当 key を削除する。 */
export function buildPreviewSearchParams(
  current: URLSearchParams | ReadonlyURLSearchParams,
  override: {
    previewPlan?:  PlanTier | null;     // undefined = 触らない / null = 削除 / 値 = 更新
    previewRole?:  PreviewRole | null;  // 同上
  },
): URLSearchParams {
  const next = new URLSearchParams(current.toString());
  if (override.previewPlan !== undefined) {
    if (override.previewPlan === null) next.delete("previewPlan");
    else next.set("previewPlan", override.previewPlan);
  }
  if (override.previewRole !== undefined) {
    if (override.previewRole === null) next.delete("previewRole");
    else next.set("previewRole", override.previewRole);
  }
  return next;
}

/** Next.js の useSearchParams が返す型と互換にするための型エイリアス */
interface ReadonlyURLSearchParams {
  toString(): string;
  get(name: string): string | null;
}
