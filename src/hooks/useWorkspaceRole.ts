"use client";

/**
 * useWorkspaceRole — 現在ユーザーの workspace ロールを取得する hook
 *
 * workspace_id = oa_id（MVP）
 * ロール階層: owner > admin > editor > tester > viewer
 *
 * platform owner は PREVIEW_WS_ROLE_KEY を localStorage に設定することで、
 * 任意の workspace role として UI を確認できる（権限プレビュー機能）。
 * プレビュー変更は PREVIEW_WS_ROLE_EVENT カスタムイベントで即時反映される。
 *
 * @example
 * const { role, loading, isOwner, isAdmin, canEdit, isTester, isViewer } = useWorkspaceRole(oaId);
 */

import { useState, useEffect } from "react";
import { getAuthHeaders } from "@/lib/api-client";
import type { Role } from "@/lib/types/permissions";
import { roleAtLeast } from "@/lib/types/permissions";

// ── プレビュー定数（usePlatformRole.ts と同値・循環 import 回避のため重複定義） ──
/** @see usePlatformRole.ts PREVIEW_WS_ROLE_KEY */
const PREVIEW_WS_ROLE_KEY   = "ws_ws_role_preview";
/** @see usePlatformRole.ts PREVIEW_WS_ROLE_EVENT */
const PREVIEW_WS_ROLE_EVENT = "ws-preview-role-changed";

const VALID_ROLES: string[] = ["owner", "admin", "editor", "tester", "viewer"];

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

export function useWorkspaceRole(workspaceId: string): WorkspaceRoleState {
  const [role,    setRole]    = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  // ── 実ロールを API から取得するヘルパー ──────────────────────────
  function fetchRealRole(wsId: string) {
    setLoading(true);
    fetch(`/api/oas/${wsId}/members/me`, { headers: { ...getAuthHeaders() } })
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setRole(json.data.role as Role);
      })
      .catch(() => {
        // 取得失敗時は viewer として扱う（フロントの安全側倒し）
        setRole("viewer");
      })
      .finally(() => setLoading(false));
  }

  // ── 初回 / workspaceId 変更時 ─────────────────────────────────────
  useEffect(() => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }

    // platform owner の workspace role プレビューを優先適用
    try {
      const preview = localStorage.getItem(PREVIEW_WS_ROLE_KEY);
      if (preview && VALID_ROLES.includes(preview)) {
        setRole(preview as Role);
        setLoading(false);
        return;
      }
    } catch {}

    fetchRealRole(workspaceId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // ── プレビューロール変更イベントで即時反映 ─────────────────────────
  useEffect(() => {
    const handlePreviewChange = (e: Event) => {
      const newRole = (e as CustomEvent<Role | null>).detail;
      if (newRole === null) {
        // プレビュー解除 → 実ロールを再取得
        if (workspaceId) fetchRealRole(workspaceId);
      } else if (VALID_ROLES.includes(newRole)) {
        setRole(newRole);
        setLoading(false);
      }
    };
    window.addEventListener(PREVIEW_WS_ROLE_EVENT, handlePreviewChange);
    return () => window.removeEventListener(PREVIEW_WS_ROLE_EVENT, handlePreviewChange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return {
    role,
    loading,
    isOwner:  role === "owner",
    isAdmin:  role !== null && roleAtLeast(role, "admin"),
    canEdit:  role !== null && roleAtLeast(role, "tester"),   // tester / editor / admin / owner
    isTester: role === "tester",
    isViewer: role === "viewer",
  };
}
