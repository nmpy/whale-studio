"use client";

/**
 * useWorkspaceRole — 現在ユーザーの workspace ロールを取得する hook
 *
 * workspace_id = oa_id（MVP）
 * ロール階層: owner > admin > editor > tester > viewer
 *
 * ロールは常に /api/oas/{id}/members/me から取得する。
 * サーバー側の getWorkspaceRole() が唯一の source of truth。
 *
 * Whale Studio Live（隠し上位機能）の情報も同 API から取得する:
 *   - liveEnabled: OA で Live が有効か
 *   - liveRole:    自分の Live ロール（null = Live 権限なし）
 *   - liveAccess:  Live にアクセスできるか（platform admin / OA owner / liveRole 保持）
 * Live 無効 OA・権限なしユーザーには false / null が返る（存在を露出しない）。
 *
 * @example
 * const { role, loading, isOwner, isAdmin, canEdit, isTester, isViewer, liveAccess } = useWorkspaceRole(oaId);
 */

import { useState, useEffect, useRef } from "react";
import { getAuthHeaders } from "@/lib/api-client";
import type { Role, LiveRole } from "@/lib/types/permissions";
import { roleAtLeast } from "@/lib/types/permissions";

/**
 * 同一 workspaceId に対する未解決の /members/me fetch を共有するための module-scope Map。
 *
 * 同じ OA を扱う複数のコンポーネント（例: SideNav と各ページ）が同時 mount したとき、
 * このマップに既存 Promise があればそれを await し、無ければ新規 fetch を登録する。
 * Promise が settle した時点（成功/失敗どちらでも）で Map から即削除し、stale な
 * レスポンスが後続の使用者に再利用されることを防ぐ。
 */
type MeResponse = {
  success: boolean;
  data?: {
    role: Role;
    live_enabled?: boolean;
    live_role?: LiveRole | null;
    live_access?: boolean;
  };
};
const inflight = new Map<string, Promise<MeResponse>>();

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
  /** OA で Whale Studio Live が有効か */
  liveEnabled: boolean;
  /** 自分の Live ロール（null = Live 権限なし） */
  liveRole: LiveRole | null;
  /** Live にアクセスできるか（メニュー表示の判定に使う） */
  liveAccess: boolean;
}

export function useWorkspaceRole(workspaceId: string): WorkspaceRoleState {
  const [role,        setRole]        = useState<Role | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [liveRole,    setLiveRole]    = useState<LiveRole | null>(null);
  const [liveAccess,  setLiveAccess]  = useState(false);

  // mount フラグ。fetch 完了時点で unmount されていれば setState を抑止する。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    // 旧プレビュー機能の localStorage 残骸を除去（一度だけ）
    try { localStorage.removeItem("ws_ws_role_preview"); } catch {}

    if (!workspaceId) {
      setLoading(false);
      return;
    }

    // この effect 実行時点の workspaceId を closure で固定。
    // fetch 完了までに workspaceId が変わったら、その結果は捨てる（古い state を新しい
    // workspaceId に書き込まない）。
    const requestedId = workspaceId;
    let cancelled = false;

    setLoading(true);

    // 同一 workspaceId への未解決 fetch があれば共有、無ければ新規発行して Map に登録。
    // settle 時点（成功/失敗いずれでも）で Map から削除し、stale な値の再利用を防ぐ。
    let promise = inflight.get(requestedId);
    if (!promise) {
      promise = fetch(`/api/oas/${requestedId}/members/me`, {
        headers: { ...getAuthHeaders() },
        cache:   "no-store",
      })
        .then((res) => res.json() as Promise<MeResponse>)
        .finally(() => { inflight.delete(requestedId); });
      inflight.set(requestedId, promise);
    }

    promise
      .then((json) => {
        // unmount または workspaceId 変更後の resolve は捨てる
        if (cancelled || !mountedRef.current) return;
        if (workspaceId !== requestedId) return;
        if (json.success && json.data) {
          setRole(json.data.role);
          setLiveEnabled(json.data.live_enabled === true);
          setLiveRole(json.data.live_role ?? null);
          setLiveAccess(json.data.live_access === true);
        }
      })
      .catch(() => {
        if (cancelled || !mountedRef.current) return;
        if (workspaceId !== requestedId) return;
        setRole("viewer");
      })
      .finally(() => {
        if (cancelled || !mountedRef.current) return;
        if (workspaceId !== requestedId) return;
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [workspaceId]);

  return {
    role,
    loading,
    isOwner:  role === "owner",
    isAdmin:  role !== null && roleAtLeast(role, "admin"),
    canEdit:  role !== null && roleAtLeast(role, "tester"),
    isTester: role === "tester",
    isViewer: role === "viewer",
    liveEnabled,
    liveRole,
    liveAccess,
  };
}
