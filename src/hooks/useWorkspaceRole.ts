"use client";

/**
 * useWorkspaceRole — 現在ユーザーの workspace ロールを取得する hook
 *
 * workspace_id = oa_id（MVP）
 * ロール階層: owner > admin > editor > tester > viewer
 *
 * SSR 済みの初期ロールがある場合はそれを使う。
 * 初期値がない場合だけ /api/oas/{id}/members/me から取得する。
 *
 * @example
 * const { role, loading, isOwner, isAdmin, canEdit, isTester, isViewer } = useWorkspaceRole(oaId);
 */

import { useState, useEffect } from "react";
import { getAuthHeaders } from "@/lib/api-client";
import type { Role } from "@/lib/types/permissions";
import { roleAtLeast } from "@/lib/types/permissions";

export interface WorkspaceRoleState {
  role:     Role | null;
  loading:  boolean;
  /** owner かどうか */
  isOwner:  boolean;
  /** admin 以上かどうか（admin / owner）— メンバー管理・OA 設定の権限 */
  isAdmin:  boolean;
  /** tester 以上かどうか（tester / editor / admin / owner）— コンテンツ作成・編集の権限 */
  canEdit:  boolean;
  /** tester かどうか（体験ロール — コンテンツ作成のみ可、メンバー管理・OA 設定は不可） */
  isTester: boolean;
  /** viewer かどうか（閲覧専用） */
  isViewer: boolean;
}

const workspaceRoleCache = new Map<string, Role>();

export function rememberWorkspaceRole(workspaceId: string, role: Role | null | undefined) {
  if (!workspaceId || !role) return;
  workspaceRoleCache.set(workspaceId, role);
}

export function useWorkspaceRole(
  workspaceId: string,
  initialRole?: Role | null,
): WorkspaceRoleState {
  const cachedRole = workspaceId ? workspaceRoleCache.get(workspaceId) ?? null : null;
  const resolvedInitialRole = initialRole ?? cachedRole;
  const hasInitialRole = resolvedInitialRole !== null;

  const [role,    setRole]    = useState<Role | null>(resolvedInitialRole);
  const [loading, setLoading] = useState(!hasInitialRole);

  useEffect(() => {
    // 旧プレビュー機能の localStorage 残骸を除去（一度だけ）
    try { localStorage.removeItem("ws_ws_role_preview"); } catch {}

    if (!workspaceId) {
      setRole(null);
      setLoading(false);
      return;
    }

    const cached = workspaceRoleCache.get(workspaceId);
    const seedRole = initialRole ?? cached;
    if (seedRole) {
      workspaceRoleCache.set(workspaceId, seedRole);
      setRole(seedRole);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`/api/oas/${workspaceId}/members/me`, {
      headers: { ...getAuthHeaders() },
      cache:   "no-store",
    })
      .then((res) => res.json())
      .then((json) => {
        if (json.success) {
          const nextRole = json.data.role as Role;
          workspaceRoleCache.set(workspaceId, nextRole);
          setRole(nextRole);
        }
      })
      .catch(() => {
        setRole("viewer");
        workspaceRoleCache.set(workspaceId, "viewer");
      })
      .finally(() => setLoading(false));
  }, [workspaceId, initialRole]);

  return {
    role,
    loading,
    isOwner:  role === "owner",
    isAdmin:  role !== null && roleAtLeast(role, "admin"),
    canEdit:  role !== null && roleAtLeast(role, "tester"),
    isTester: role === "tester",
    isViewer: role === "viewer",
  };
}
