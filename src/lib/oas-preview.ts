// src/lib/oas-preview.ts
//
// `/oas` (= アカウント管理 / OA 一覧) ページ専用の「表示確認モード (= view preview)」helper 群。
//
// ## 目的
//
// 実 platform owner が、各ロール (= platform owner / owner / admin / editor / viewer) から
// `/oas` がどう見えるかを確認できるようにする。特に「+ アカウントを追加」CTA の
// 表示制御 (= platform owner 視点のときのみ表示) を視覚確認するための仕組み。
//
// ## 重要な制約 (= access-preview.ts と同方針)
//
// - これは **UI 表示確認専用**。実 DB / 実権限を一切変更しない。
// - 実 platform owner 以外には preview を **完全に無視** させる (= 引数 isPlatformOwner=false の
//   とき override は no-op)。
// - API 側は **絶対に preview を採用しない**。`POST /api/oas` 等は引き続き実 platform owner
//   (= `isPlatformOwner(user.id)` / server) のみで判定し、preview で権限が広がることはない。
//
// ## access-preview.ts との棲み分け
//
// - `access-preview.ts` … `/oas/[id]/...` (= OA 配下) の plan / role を URL query で preview。
// - `oas-preview.ts`    … `/oas` (= OA 一覧 / 非 OA 配下) の platform 視点を localStorage で preview。
//   一覧ページは特定 OA に紐づかないため URL query 方式 (= useAccessPreview) は使えず、
//   既存の `usePlatformRole` (= localStorage 方式) を踏襲する。

import type { Role } from "@/lib/types/permissions";

// ────────────────────────────────────────────────
// OasViewRole
// ────────────────────────────────────────────────

/** `/oas` 表示確認モードで選べる視点。
 *  - "platform_owner" … 実 platform owner 視点 (= サービス運営者。「+ アカウントを追加」を表示)
 *  - owner/admin/editor/viewer … 一般ユーザー (= workspace role) 視点 (= CTA 非表示)
 *
 *  tester は `/oas` 一覧では区別する UI を持たないため対象外 (= 必要になれば追加)。 */
export const OAS_VIEW_ROLES = ["platform_owner", "owner", "admin", "editor", "viewer"] as const;
export type OasViewRole = typeof OAS_VIEW_ROLES[number];

/** workspace role 視点として扱う値 (= platform_owner 以外)。 */
export type OasPreviewWsRole = Exclude<OasViewRole, "platform_owner">;

/** OasViewRole の日本語表示名 (= select / バッジ用)。 */
export const OAS_VIEW_ROLE_LABELS: Record<OasViewRole, string> = {
  platform_owner: "プラットフォームオーナー",
  owner:  "オーナー",
  admin:  "管理者",
  editor: "編集者",
  viewer: "閲覧者",
};

/** select の表示順。 */
export const OAS_VIEW_ROLE_ORDER: readonly OasViewRole[] = [
  "platform_owner", "owner", "admin", "editor", "viewer",
];

// ────────────────────────────────────────────────
// 入力 normalize / validate
// ────────────────────────────────────────────────

/** localStorage 等から渡される値を OasViewRole に安全に変換する。
 *  許可値以外 / null / 空文字は null を返す (= preview 無効扱い → platform_owner 既定)。 */
export function parseOasViewRole(raw: string | null | undefined): OasViewRole | null {
  if (!raw) return null;
  const v = raw.trim();
  return (OAS_VIEW_ROLES as readonly string[]).includes(v) ? (v as OasViewRole) : null;
}

// ────────────────────────────────────────────────
// 表示判定 (= UI 専用)
// ────────────────────────────────────────────────

/** 現在 platform owner 視点で `/oas` を見ているか。
 *  - 実 platform owner でなければ常に false (= preview を完全無視)
 *  - preview 未指定 (= null) または "platform_owner" 選択中なら true
 *  - owner/admin/editor/viewer を選択中なら false (= 一般ユーザー視点)
 *
 *  「+ アカウントを追加」CTA / お知らせ投稿 / OA 削除ボタンの表示はこれに連動する。
 *  ※ あくまで UI 表示用。`POST /api/oas` は server 側で実 platform owner を別途検証する。 */
export function viewingAsPlatformOwner(args: {
  isPlatformOwner: boolean;
  previewViewRole: OasViewRole | null;
}): boolean {
  if (!args.isPlatformOwner) return false;
  return args.previewViewRole === null || args.previewViewRole === "platform_owner";
}

/** 「+ アカウントを追加」を表示してよいか。
 *  platform owner 視点のときのみ true (= viewingAsPlatformOwner と同義の意味づけ)。 */
export function canCreateOaInView(args: {
  isPlatformOwner: boolean;
  previewViewRole: OasViewRole | null;
}): boolean {
  return viewingAsPlatformOwner(args);
}

/** 表示確認中か (= platform owner が platform_owner 以外の視点を選択中)。
 *  バッジ / 解除ボタンの表示判定に使う。 */
export function isPreviewingOasView(args: {
  isPlatformOwner: boolean;
  previewViewRole: OasViewRole | null;
}): boolean {
  return (
    args.isPlatformOwner &&
    args.previewViewRole !== null &&
    args.previewViewRole !== "platform_owner"
  );
}

/** preview 中の workspace role を返す (= owner/admin/editor/viewer のときのみ)。
 *  platform_owner / 未指定 / 非 platform owner の場合は null。
 *  Role 型 (= RoleBadge 等) に渡したいときに使う。 */
export function previewWsRoleOf(args: {
  isPlatformOwner: boolean;
  previewViewRole: OasViewRole | null;
}): Role | null {
  if (!isPreviewingOasView(args)) return null;
  // platform_owner は上で除外済みなので残りは必ず Role のサブセット。
  return args.previewViewRole as Role;
}
