"use client";

// src/hooks/usePlatformRole.ts
// プラットフォームロール（owner / user）管理フック。
//
// - /api/admin/me から is_platform_owner を取得する
// - プラットフォームオーナーは localStorage にプレビューロールを保存し、
//   一般ユーザーからの見え方をシミュレートできる（管理用途限定）
// - effectiveRole: 実際の UI 制御に使うロール（preview 中はそのロール）
//
// ⚠ platform role は管理機能の出し分け（AnnouncementBanner, admin 画面等）にのみ使用する。
//   コンテンツの閲覧・編集制御は workspace role を使うこと。

import { useEffect, useState, useCallback } from "react";
import { getDevToken } from "@/lib/api-client";

/** プラットフォームロール: サービス全体の管理権限 */
export type PlatformRole = "owner" | "user";

const PREVIEW_KEY = "ws_platform_preview";

export function usePlatformRole() {
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [previewRole, setPreviewRoleState]    = useState<PlatformRole | null>(null);
  const [loading, setLoading]                 = useState(true);

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

  // プレビュー中かどうか（オーナーが一般ユーザー表示中）
  const isPreviewing = isPlatformOwner && previewRole !== null;

  // 実際の UI 制御に使うロール
  // プレビュー中はそのロール、そうでなければ実際のロール
  const effectiveRole: PlatformRole =
    isPlatformOwner
      ? (previewRole ?? "owner")
      : "user";

  return {
    /** /api/admin/me で確認した実際のプラットフォームロール */
    isPlatformOwner,
    /** 現在プレビュー中のロール（null = プレビューなし） */
    previewRole,
    /** UI 制御に使うロール（プレビュー中はそのロール） */
    effectiveRole,
    /** オーナーがプレビュー中かどうか */
    isPreviewing,
    loading,
    /** プレビューロールを切り替える（null でリセット） */
    setPreviewRole,
  };
}
