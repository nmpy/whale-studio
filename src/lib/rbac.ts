/**
 * RBAC ヘルパー
 * workspace（= OA）単位のロール取得・チェック
 */

import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import type { Role } from '@/lib/types/permissions';
import { roleAtLeast } from '@/lib/types/permissions';

/**
 * 指定ワークスペースでのユーザーロールを取得する。
 * - dev スタブ（SUPABASE_URL 未設定 + dev-user）: 常に 'owner' を返す
 * - メンバー未登録: null を返す
 */
export async function getWorkspaceRole(
  workspaceId: string,
  userId: string
): Promise<Role | null> {
  // dev スタブ: Supabase 未設定 の開発環境では常に owner
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NODE_ENV === 'development' &&
    userId === 'dev-user'
  ) {
    return 'owner';
  }

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  return member ? (member.role as Role) : null;
}

/**
 * Work ID から oa_id（= workspace_id）を取得するユーティリティ。
 * Work 配下のリソース（message/phase/character）の権限チェックに使う。
 */
export async function getOaIdFromWorkId(workId: string): Promise<string | null> {
  const work = await prisma.work.findUnique({
    where: { id: workId },
    select: { oaId: true },
  });
  return work?.oaId ?? null;
}

/**
 * Phase ID から oa_id を取得するユーティリティ。
 */
export async function getOaIdFromPhaseId(phaseId: string): Promise<string | null> {
  const phase = await prisma.phase.findUnique({
    where: { id: phaseId },
    select: { work: { select: { oaId: true } } },
  });
  return phase?.work?.oaId ?? null;
}

/**
 * workspaceId + userId でロールを確認し、minRole 未満なら 403 NextResponse を返す。
 * API ルート内でインライン権限チェックをするための使い捨てヘルパー。
 *
 * @example
 * const check = await requireRole(oaId, user.id, 'editor');
 * if (!check.ok) return check.response;
 * // check.role が使える
 */
export async function requireRole(
  workspaceId: string,
  userId: string,
  minRole: Role
): Promise<
  | { ok: true;  role: Role }
  | { ok: false; response: NextResponse }
> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (!role) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'このワークスペースへのアクセス権がありません' } },
        { status: 403 }
      ),
    };
  }
  if (!roleAtLeast(role, minRole)) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: '権限が不足しています' } },
        { status: 403 }
      ),
    };
  }
  return { ok: true, role };
}

export { roleAtLeast };
