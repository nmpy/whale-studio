// src/lib/uzupro.ts
// for ウズプロ（UZU_PRO）機能の権限判定（サーバーサイド専用）。
//
// アクセス条件（spec §2）= 次の両方を満たすこと:
//   (1) ユーザーが「for ウズプロ」利用権限（per-user grant = UzuProGrant）を保有する
//   (2) 対象作品(OA)へのアクセス権限を持つ（= 当該 OA の active メンバー）
//
// ⚠️ platform owner でも **UzuProGrant が無ければプレイヤー機能は利用不可**（spec §5）。
//    isPlatformOwner による RBAC 短絡で利用権限を迂回させない。platform owner の特権は
//    「Grant 管理 API（/api/admin/uzu-pro-grants）」のみ。ただし対象作品(OA)アクセスの判定
//    （getWorkspaceRole）は platform owner が全 OA を owner 扱いする既存短絡をそのまま利用する
//    （= 作品アクセスは満たすが、Grant は別途必須）。
//
// 付与/解除は platform owner のみ。権限が無いユーザーには
// サイドバー「FOR ウズプロ」を出さず、ページ/Server/API すべてサーバー側で拒否する。

import { prisma } from "@/lib/prisma";
import { getWorkspaceRole } from "@/lib/rbac";

/** 機能キー（監査ログ等の安定値）。 */
export const UZU_PRO_FEATURE = "uzu_pro" as const;

/** per-user の for ウズプロ利用権限（UzuProGrant）を保有するか。 */
export async function hasUzuProGrant(userId: string): Promise<boolean> {
  if (!userId) return false;
  const g = await prisma.uzuProGrant.findUnique({
    where: { userId },
    select: { id: true },
  });
  return !!g;
}

/** 当該 OA の active メンバーか（= 対象作品へのアクセス権限）。 */
async function isActiveOaMember(oaId: string, userId: string): Promise<boolean> {
  const info = await getWorkspaceRole(oaId, userId);
  return !!info && info.status === "active";
}

/**
 * for ウズプロへアクセスできるか。
 * platform owner は常に可。それ以外は「利用権限グラント保有 かつ 当該 OA の active メンバー」。
 */
export async function canAccessUzuPro(oaId: string, userId: string): Promise<boolean> {
  if (!userId) return false;
  // Grant は platform owner でも必須（迂回不可）。
  if (!(await hasUzuProGrant(userId))) return false;
  return isActiveOaMember(oaId, userId);
}

/**
 * members/me などクライアントへ渡すフラグ。
 *   granted = 利用権限グラント保有（platform owner は true 扱い）
 *   access  = この OA で実際に for ウズプロを開けるか（granted かつ OA メンバー）
 * ※ granted/access はナビ表示制御用。実際の強制は常にサーバー側ガード（canAccessUzuPro / authorizeUzuPro）。
 */
export async function getUzuProAccess(
  oaId: string,
  userId: string,
): Promise<{ granted: boolean; access: boolean }> {
  if (!userId) return { granted: false, access: false };
  // Grant は platform owner でも必須（迂回不可）。granted=false なら access も false。
  const granted = await hasUzuProGrant(userId);
  if (!granted) return { granted: false, access: false };
  const access = await isActiveOaMember(oaId, userId);
  return { granted, access };
}
