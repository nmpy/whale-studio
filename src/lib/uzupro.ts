// src/lib/uzupro.ts
// for UZU Pro（UZU_PRO）機能の権限判定（サーバーサイド専用）。
//
// アクセス条件（確定モデル・3 条件の AND）:
//   (1) Work.uzuProEnabled = true（作品単位で for UZU Pro を有効化済み）
//   (2) ユーザーが per-user 利用権限 UzuProGrant を保有（platform owner でも明示 Grant 必須・迂回不可）
//   (3) ユーザーが対象 OA の active メンバー
//
// canAccessUzuPro / getUzuProAccess はこの 3 条件を正本として判定する。
// 作品の有効化（uzuProEnabled のトグル）は owner / platform owner のみ（canManageUzuProWork）。
// UzuProGrant の付与/解除は platform owner のみ（既存 /api/admin/uzu-pro-grants）。
// 権限が無い場合はサイドバー「FOR ウズプロ」を出さず、ページ/Server/API すべてサーバー側で拒否する。

import { prisma } from "@/lib/prisma";
import { getWorkspaceRole } from "@/lib/rbac";
import { isPlatformOwner } from "@/lib/platform-admin";

/** 機能キー（監査ログ等の安定値）。 */
export const UZU_PRO_FEATURE = "uzu_pro" as const;

/** per-user の for ウズプロ利用権限（UzuProGrant）を保有するか。 */
export async function hasUzuProGrant(userId: string): Promise<boolean> {
  if (!userId) return false;
  const g = await prisma.uzuProGrant.findUnique({ where: { userId }, select: { id: true } });
  return !!g;
}

/** 当該 OA の active メンバーか。 */
async function isActiveOaMember(oaId: string, userId: string): Promise<boolean> {
  const info = await getWorkspaceRole(oaId, userId);
  return !!info && info.status === "active";
}

/** 対象作品が当該 OA に属し、かつ for UZU Pro 有効化済みか。 */
export async function isWorkUzuProEnabled(oaId: string, workId: string): Promise<boolean> {
  if (!oaId || !workId) return false;
  const w = await prisma.work.findFirst({
    where: { id: workId, oaId },
    select: { uzuProEnabled: true },
  });
  return !!w?.uzuProEnabled;
}

/**
 * for UZU Pro へアクセスできるか（3 条件の AND）。
 * 必ず workId を含めて判定する（per-OA だけで完結させない）。
 */
export async function canAccessUzuPro(oaId: string, userId: string, workId: string): Promise<boolean> {
  if (!userId || !oaId || !workId) return false;
  const [workEnabled, granted, member] = await Promise.all([
    isWorkUzuProEnabled(oaId, workId),
    hasUzuProGrant(userId),
    isActiveOaMember(oaId, userId),
  ]);
  return workEnabled && granted && member;
}

/**
 * クライアント（ナビ表示制御 / 設定画面の状態説明）へ渡すフラグ群。
 * workEnabled / granted / member を個別に返し、access = 3 条件の AND。
 * ※ 実際の強制は常にサーバー側ガード（canAccessUzuPro / authorizeUzuPro）が行う。
 */
export async function getUzuProAccess(
  oaId: string,
  userId: string,
  workId: string,
): Promise<{ workEnabled: boolean; granted: boolean; member: boolean; access: boolean }> {
  if (!userId || !oaId || !workId) {
    return { workEnabled: false, granted: false, member: false, access: false };
  }
  const [workEnabled, granted, member] = await Promise.all([
    isWorkUzuProEnabled(oaId, workId),
    hasUzuProGrant(userId),
    isActiveOaMember(oaId, userId),
  ]);
  return { workEnabled, granted, member, access: workEnabled && granted && member };
}

/**
 * 作品の for UZU Pro 有効化を変更できるか（owner / platform owner のみ）。
 * editor / tester / viewer 等の作品設定権限を持たないロールは不可。
 */
export async function canManageUzuProWork(oaId: string, userId: string): Promise<boolean> {
  if (!userId || !oaId) return false;
  if (isPlatformOwner(userId)) return true;
  const info = await getWorkspaceRole(oaId, userId);
  return !!info && info.status === "active" && info.role === "owner";
}
