/**
 * RBAC ヘルパー
 * workspace（= OA）単位のロール取得・チェック
 */

import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import type { Role, MemberStatus } from '@/lib/types/permissions';
import { roleAtLeast } from '@/lib/types/permissions';

// ── 型 ────────────────────────────────────────────────────────────────

/** getWorkspaceRole の戻り値。未所属なら null */
export type MemberInfo = {
  role:   Role;
  status: MemberStatus;
} | null;

// ── ユーティリティ ────────────────────────────────────────────────────

/**
 * 指定ワークスペースでのメンバー情報（role + status）を取得する。
 *
 * - dev スタブ（BYPASS_AUTH / dev-user）: `{ role: 'owner', status: 'active' }` を返す
 * - メンバー未登録: `null` を返す
 *
 * ⚠ status チェックはこの関数では行わない。
 *   呼び出し側（requireRole / withRole）で inactive / suspended を拒否すること。
 */
export async function getWorkspaceRole(
  workspaceId: string,
  userId: string
): Promise<MemberInfo> {
  // BYPASS_AUTH=true 時のスタブ
  if (userId === 'bypass-admin') {
    return { role: 'owner', status: 'active' };
  }

  // dev スタブ: Supabase 未設定の開発環境では常に owner
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NODE_ENV === 'development' &&
    userId === 'dev-user'
  ) {
    return { role: 'owner', status: 'active' };
  }

  const member = await prisma.workspaceMember.findUnique({
    where:  { workspaceId_userId: { workspaceId, userId } },
    select: { role: true, status: true },
  });

  if (!member) return null;

  return {
    role:   member.role   as Role,
    status: member.status as MemberStatus,
  };
}

/**
 * Work ID から oa_id（= workspace_id）を取得するユーティリティ。
 * Work 配下のリソース（message/phase/character）の権限チェックに使う。
 */
export async function getOaIdFromWorkId(workId: string): Promise<string | null> {
  const work = await prisma.work.findUnique({
    where:  { id: workId },
    select: { oaId: true },
  });
  return work?.oaId ?? null;
}

/**
 * Phase ID から oa_id を取得するユーティリティ。
 */
export async function getOaIdFromPhaseId(phaseId: string): Promise<string | null> {
  const phase = await prisma.phase.findUnique({
    where:  { id: phaseId },
    select: { work: { select: { oaId: true } } },
  });
  return phase?.work?.oaId ?? null;
}

// ── 共通エラーレスポンス ──────────────────────────────────────────────

function forbidden(code: string, message: string): NextResponse {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status: 403 }
  );
}

// ── requireRole ───────────────────────────────────────────────────────

/**
 * workspaceId + userId でメンバーシップ・status・ロールを確認し、
 * 問題があれば 403 NextResponse を返す。
 *
 * 判定順:
 *  1. メンバー未所属 → 403 FORBIDDEN
 *  2. status = inactive  → 403 MEMBER_INACTIVE
 *  3. status = suspended → 403 MEMBER_SUSPENDED
 *  4. ロールチェック不足 → 403 FORBIDDEN
 *
 * allowedRoles の指定方法:
 *  - 単一 Role 文字列 ('editor') → roleAtLeast による階層チェック（editor 以上が通過）
 *  - Role[] 配列 (['owner', 'admin']) → 配列に含まれるロールのみ通過（完全一致）
 *
 * @example
 * const check = await requireRole(oaId, user.id, 'editor');
 * if (!check.ok) return check.response;
 * // check.role が使える
 */
export async function requireRole(
  workspaceId: string,
  userId: string,
  allowedRoles: Role | Role[]
): Promise<
  | { ok: true;  role: Role; status: MemberStatus }
  | { ok: false; response: NextResponse }
> {
  const member = await getWorkspaceRole(workspaceId, userId);

  // 1. 未所属
  if (!member) {
    return { ok: false, response: forbidden('WORKSPACE_ACCESS_DENIED', 'このワークスペースへのアクセス権がありません') };
  }

  // 2. inactive（一時停止）
  if (member.status === 'inactive') {
    return { ok: false, response: forbidden('MEMBER_INACTIVE', 'メンバーシップが一時停止されています') };
  }

  // 3. suspended（強制停止）
  if (member.status === 'suspended') {
    return { ok: false, response: forbidden('MEMBER_SUSPENDED', 'このアカウントは利用停止されています。オーナーにお問い合わせください') };
  }

  // 4. ロールチェック
  const allowed = Array.isArray(allowedRoles)
    ? allowedRoles.includes(member.role)
    : roleAtLeast(member.role, allowedRoles);

  if (!allowed) {
    return { ok: false, response: forbidden('FORBIDDEN', '権限が不足しています') };
  }

  return { ok: true, role: member.role, status: member.status };
}

export { roleAtLeast };
export type { Role };
export { rolesAtLeast } from '@/lib/types/permissions';
