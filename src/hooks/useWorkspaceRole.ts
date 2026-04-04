"use client";

/**
 * useWorkspaceRole — 現在ユーザーの workspace ロールを取得する hook
 *
 * workspace_id = oa_id（MVP）
 * ロール階層: owner > admin > editor > viewer
 *
 * @example
 * const { role, loading, isOwner, isAdmin, canEdit, isViewer } = useWorkspaceRole(oaId);
 */

import { useState, useEffect } from "react";
import { getDevToken } from "@/lib/api-client";
import type { Role } from "@/lib/types/permissions";
import { roleAtLeast } from "@/lib/types/permissions";

export interface WorkspaceRoleState {
  role:     Role | null;
  loading:  boolean;
  /** owner かどうか */
  isOwner:  boolean;
  /** admin 以上かどうか（admin / owner） */
  isAdmin:  boolean;
  /** editor 以上かどうか（editor / admin / owner） */
  canEdit:  boolean;
  /** viewer かどうか（閲覧専用） */
  isViewer: boolean;
}

export function useWorkspaceRole(workspaceId: string): WorkspaceRoleState {
  const [role, setRole]       = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }

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

  const isViewer = role === "viewer";

  return {
    role,
    loading,
    isOwner:  role === "owner",
    isAdmin:  role !== null && roleAtLeast(role, "admin"),
    canEdit:  role !== null && roleAtLeast(role, "editor"),
    isViewer,
  };
}
