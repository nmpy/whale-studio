"use client";

/**
 * useWorkspaceRole — 現在ユーザーの workspace ロールを取得する hook
 *
 * workspace_id = oa_id（MVP）
 *
 * @example
 * const { role, loading, isOwner, canEdit, isViewer } = useWorkspaceRole(oaId);
 */

import { useState, useEffect } from "react";
import { getDevToken } from "@/lib/api-client";
import type { Role } from "@/lib/types/permissions";

export interface WorkspaceRoleState {
  role:     Role | null;
  loading:  boolean;
  /** owner かどうか */
  isOwner:  boolean;
  /** editor 以上かどうか（owner / editor） */
  canEdit:  boolean;
  /** viewer かどうか（閲覧専用） */
  isViewer: boolean;
}

export function useWorkspaceRole(workspaceId: string): WorkspaceRoleState {
  const [role, setRole]       = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) return;

    setLoading(true);
    fetch(`/api/oas/${workspaceId}/members/me`, {
      headers: { Authorization: `Bearer ${getDevToken()}` },
    })
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setRole(json.data.role as Role);
      })
      .catch(() => {
        // 取得失敗時は viewer として扱う（フロントの安全側倒し）
        setRole("viewer");
      })
      .finally(() => setLoading(false));
  }, [workspaceId]);

  return {
    role,
    loading,
    isOwner:  role === "owner",
    canEdit:  role === "owner" || role === "editor",
    isViewer: role === "viewer",
  };
}
