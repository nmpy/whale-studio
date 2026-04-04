"use client";

// src/hooks/usePlatformRole.ts
// プラットフォームロール（owner / user）管理フック。
//
// - /api/admin/me から is_platform_owner を取得する
// - プラットフォームオーナーは localStorage にプレビューロールを保存し、
//   一般ユーザーからの見え方をシミュレートできる（管理用途限定）
// - effectiveRole: 実際の UI 制御に使うロール（preview 中はそのロール）
// - previewWsRole: workspace role プレビュー（オーナーが各権限の見え方を確認するため）
//
// ⚠ platform role は管理機能の出し分け（AnnouncementBanner, admin 画面等）にのみ使用する。
//   コンテンツの閲覧・編集制御は workspace role を使うこと。

import { useEffect, useState, useCallback } from "react";
import { getDevToken } from "@/lib/api-client";
import type { Role } from "@/lib/types/permissions";

/** プラットフォームロール: サービス全体の管理権限 */
export type PlatformRole = "owner" | "user";

const PREVIEW_KEY = "ws_platform_preview";

/**
 * platform owner が workspace role プレビューに使う localStorage キー。
 * useWorkspaceRole でも同一値を参照する（循環 import 回避のため定数を共有しない）。
 */
export const PREVIEW_WS_ROLE_KEY = "ws_ws_role_preview";

/**
 * workspace role プレビュー変更を同タブ内の useWorkspaceRole に即時反映するカスタムイベント。
 * detail: Role | null（null = プレビュー解除）
 */
export const PREVIEW_WS_ROLE_EVENT = "ws-preview-role-changed";

export function usePlatformRole() {
  const [isPlatformOwner,   setIsPlatformOwner]   = useState(false);
  const [previewRole,       setPreviewRoleState]   = useState<PlatformRole | null>(null);
  const [previewWsRole,     setPreviewWsRoleState] = useState<Role | null>(null);
  const [loading,           setLoading]            = useState(true);

  useEffect(() => {
    // localStorage からプレビューロールを復元（SSR では動かないため useEffect 内で実行）
    try {
      const saved = localStorage.getItem(PREVIEW_KEY) as PlatformRole | null;
      if (saved === "owner" || saved === "user") {
        setPreviewRoleState(saved);
      }
    } catch {
      // localStorage 使用不可環境では無視
    }

    try {
      const savedWs = localStorage.getItem(PREVIEW_WS_ROLE_KEY) as Role | null;
      if (savedWs && (["owner", "admin", "editor", "viewer"] as string[]).includes(savedWs)) {
        setPreviewWsRoleState(savedWs);
      }
    } catch {}

    // /api/admin/me からプラットフォームオーナー判定を取得
    fetch("/api/admin/me", {
      headers: { Authorization: `Bearer ${getDevToken()}` },
    })
      .then((r) => {
        if (!r.ok) return null;
        return r.json() as Promise<{ data?: { is_platform_owner?: boolean } }>;
      })
      .then((body) => {
        if (body?.data?.is_platform_owner) {
          setIsPlatformOwner(true);
        }
      })
      .catch(() => {
        // ネットワークエラー時は一般ユーザー扱い
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // プラットフォームロールのプレビュー切り替え
  const setPreviewRole = useCallback((role: PlatformRole | null) => {
    setPreviewRoleState(role);
    try {
      if (role) {
        localStorage.setItem(PREVIEW_KEY, role);
      } else {
        localStorage.removeItem(PREVIEW_KEY);
      }
    } catch {
      // ignore
    }
  }, []);

  /**
   * workspace role プレビューを切り替える（null でリセット）。
   * 同タブ内の useWorkspaceRole に即時反映するため PREVIEW_WS_ROLE_EVENT を dispatch する。
   */
  const setPreviewWsRole = useCallback((role: Role | null) => {
    setPreviewWsRoleState(role);
    try {
      if (role) {
        localStorage.setItem(PREVIEW_WS_ROLE_KEY, role);
      } else {
        localStorage.removeItem(PREVIEW_WS_ROLE_KEY);
      }
    } catch {}
    // 同タブ内の useWorkspaceRole に即時反映
    window.dispatchEvent(
      new CustomEvent(PREVIEW_WS_ROLE_EVENT, { detail: role })
    );
  }, []);

  // プレビュー中かどうか（プラットフォームロール）
  const isPreviewing = isPlatformOwner && previewRole !== null;

  // workspace role プレビュー中かどうか
  const isPreviewingWsRole = isPlatformOwner && previewWsRole !== null;

  // 実際の UI 制御に使うプラットフォームロール
  const effectiveRole: PlatformRole =
    isPlatformOwner
      ? (previewRole ?? "owner")
      : "user";

  return {
    /** /api/admin/me で確認した実際のプラットフォームロール */
    isPlatformOwner,
    /** 現在プレビュー中のプラットフォームロール（null = プレビューなし） */
    previewRole,
    /** 現在プレビュー中の workspace role（null = プレビューなし） */
    previewWsRole,
    /** UI 制御に使うプラットフォームロール（プレビュー中はそのロール） */
    effectiveRole,
    /** オーナーがプラットフォームロールをプレビュー中かどうか */
    isPreviewing,
    /** オーナーが workspace role をプレビュー中かどうか */
    isPreviewingWsRole,
    loading,
    /** プラットフォームロールプレビューを切り替える（null でリセット） */
    setPreviewRole,
    /** workspace role プレビューを切り替える（null でリセット） */
    setPreviewWsRole,
  };
}
