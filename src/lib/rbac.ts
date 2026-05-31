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

/**
 * `getWorkspaceRole` / `requireRole` に preloaded された OA 情報を渡せる optional 型。
 * 渡された場合、これらの関数は内部の `Oa.findUnique({select:{ownerKey}})` をスキップする。
 *
 * これは呼び出し側で既に `prisma.oa.findUnique` を実行済みのケース（例: 存在確認の直後）
 * での 1 リクエスト内重複クエリを排除するためのもので、権限ロジックは一切変えない。
 * `preloadedOa` が未指定（undefined）の従来呼び出しは完全に同挙動。
 */
export type PreloadedOaForRbac = { ownerKey: string | null };

// ── ログ用ヘルパー ────────────────────────────────────────────────
// production では UUID の生値（userId / ownerKey / workspaceId）をログに残さない。
// 先頭 8 文字 + "…" のフィンガープリントだけ出し、判定経路の追跡を可能にする。
const _IS_PROD = process.env.NODE_ENV === "production";
function maskId(s?: string | null): string {
  if (!s) return "(none)";
  return _IS_PROD ? `${s.slice(0, 8)}…` : s;
}

export async function isAnyWorkspaceOwner(userId: string): Promise<boolean> {
  const count = await prisma.workspaceMember.count({
    where: {
      userId,
      role: 'owner',
      status: 'active',
    },
  });
  return count > 0;
}
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
  userId: string,
  options?: { preloadedOa?: PreloadedOaForRbac },
): Promise<MemberInfo> {
  // dev スタブ: Supabase 未設定の開発環境では dev-user / bypass-admin を owner として返す
  // ⚠ 本番環境（NODE_ENV=production）では絶対にスタブを返さない
  if (process.env.NODE_ENV === 'development' && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    if (userId === 'bypass-admin' || userId === 'dev-user') {
      console.warn(`[RBAC] dev stub: ${userId} → owner (workspace=${workspaceId})`);
      return { role: 'owner', status: 'active' };
    }
  }

  // ── owner_key 最優先判定 ──────────────────────────────────────
  // owner_key が設定済みかつ userId と一致 → 無条件で owner
  // 呼び出し側が `preloadedOa` を渡している場合は `Oa.findUnique` をスキップ。
  // migration 未適用の環境では owner_key カラムが存在しない可能性があるため try-catch
  let ownerKey: string | null = null;
  if (options?.preloadedOa !== undefined) {
    ownerKey = options.preloadedOa.ownerKey;
    console.log(`[RBAC] owner_key (preloaded) workspace=${maskId(workspaceId)} ownerKey=${maskId(ownerKey)} userId=${maskId(userId)} match=${ownerKey === userId}`);
    if (ownerKey && ownerKey === userId) {
      console.log(`[RBAC] → RESULT: owner (owner_key match, preloaded)`);
      return { role: 'owner', status: 'active' };
    }
  } else {
    try {
      const oa = await prisma.oa.findUnique({
        where:  { id: workspaceId },
        select: { ownerKey: true },
      });
      ownerKey = oa?.ownerKey ?? null;
      console.log(`[RBAC] owner_key lookup workspace=${maskId(workspaceId)} ownerKey=${maskId(ownerKey)} userId=${maskId(userId)} match=${ownerKey === userId}`);

      if (ownerKey && ownerKey === userId) {
        console.log(`[RBAC] → RESULT: owner (owner_key match)`);
        return { role: 'owner', status: 'active' };
      }
    } catch (err) {
      // owner_key カラムが存在しない（migration 未適用）→ スキップして従来の判定へ
      console.warn(`[RBAC] owner_key lookup FAILED (migration pending?) workspace=${maskId(workspaceId)}`, err);
    }
  }

  // ── 2b. ADMIN_IDENTITY 最優先フォールバック ─────────────────────
  // owner_key が未設定（null / migration 未適用）の場合でも、
  // ADMIN_IDENTITY と一致するユーザーは owner として扱う。
  // WorkspaceMember に editor 等がある場合でも owner_key/ADMIN_IDENTITY が勝つ。
  const adminIdentity = process.env.ADMIN_IDENTITY;
  console.log(`[RBAC] ADMIN_IDENTITY check ownerKey=${maskId(ownerKey)} adminIdentity=${maskId(adminIdentity)} userId=${maskId(userId)} match=${ownerKey === null && adminIdentity === userId}`);
  if (ownerKey === null && adminIdentity && userId === adminIdentity) {
    console.log(`[RBAC] → RESULT: owner (ADMIN_IDENTITY override)`);
    return { role: 'owner', status: 'active' };
  }

  // ── 3. WorkspaceMember テーブル検索 ────────────────────────────
  const member = await prisma.workspaceMember.findUnique({
    where:  { workspaceId_userId: { workspaceId, userId } },
    select: { role: true, status: true },
  });

  if (member) {
    console.log(`[RBAC] getWorkspaceRole workspace=${maskId(workspaceId)} user=${maskId(userId)} role=${member.role} status=${member.status}`);
    return {
      role:   member.role   as Role,
      status: member.status as MemberStatus,
    };
  }

  console.log(`[RBAC] getWorkspaceRole no membership found workspace=${maskId(workspaceId)} user=${maskId(userId)}`);
  return null;
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
  allowedRoles: Role | Role[],
  options?: { preloadedOa?: PreloadedOaForRbac },
): Promise<
  | { ok: true;  role: Role; status: MemberStatus }
  | { ok: false; response: NextResponse }
> {
  const member = await getWorkspaceRole(workspaceId, userId, options);

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

// ── Owner 保護ガード ──────────────────────────────────────────────────

/**
 * 最後のアクティブ owner を消そうとしたときに投げるエラー。
 * API ハンドラで catch → badRequest に変換する。
 */
export class LastOwnerError extends Error {
  public readonly code = 'LAST_OWNER' as const;
  constructor(message = 'このアカウントには少なくとも1人のアクティブなオーナーが必要です') {
    super(message);
    this.name = 'LastOwnerError';
  }
}

/**
 * ワークスペースに少なくとも 1 人のアクティブ owner が残ることを保証する。
 *
 * excludeMemberId を除外した状態で active owner をカウントし、
 * 0 になる場合は LastOwnerError を投げる。
 *
 * 必ず prisma.$transaction 内で呼ぶこと（race condition 防止）。
 *
 * @param workspaceId  ワークスペース ID
 * @param excludeMemberId  除外するメンバー ID（変更/削除対象）
 * @param tx  Prisma トランザクションクライアント
 */
export async function ensureActiveOwnerRemains(
  workspaceId: string,
  excludeMemberId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: { workspaceMember: { count: (...args: any[]) => Promise<number> } },
): Promise<void> {
  const activeOwnerCount = await tx.workspaceMember.count({
    where: {
      workspaceId,
      role:   'owner',
      status: 'active',
      id:     { not: excludeMemberId },
    },
  });
  if (activeOwnerCount === 0) {
    throw new LastOwnerError();
  }
}

export { roleAtLeast };
export type { Role };
export { rolesAtLeast } from '@/lib/types/permissions';
