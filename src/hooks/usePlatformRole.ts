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
import { getAuthHeaders } from "@/lib/api-client";
import { platformOwnerFromResponseBody } from "@/hooks/platform-owner";
import type { Role } from "@/lib/types/permissions";
import { parseOasViewRole, type OasViewRole } from "@/lib/oas-preview";

/** プラットフォームロール: サービス全体の管理権限 */
export type PlatformRole = "owner" | "user";

const PREVIEW_KEY = "ws_platform_preview";

/**
 * `/oas` (= OA 一覧) の「表示確認モード」用 localStorage キー。
 * platform owner が platform owner / owner / admin / editor / viewer の視点を切り替える。
 *
 * ⚠ PREVIEW_WS_ROLE_KEY ("ws_ws_role_preview") とは別キー。後者は useWorkspaceRole が
 *   mount 時に毎回 removeItem する旧残骸クリーンアップ対象で、永続化に使えない。
 *   こちらは誰も消さない専用キーとして新設する (= UI 表示専用 / API 権限には無関係)。
 */
const OAS_VIEW_PREVIEW_KEY = "ws_oas_view_preview";

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
  const [previewViewRole,   setPreviewViewRoleState] = useState<OasViewRole | null>(null);
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

    // `/oas` 表示確認モードの視点を復元（不正値は parse で弾かれて null）
    try {
      const savedView = parseOasViewRole(localStorage.getItem(OAS_VIEW_PREVIEW_KEY));
      if (savedView) setPreviewViewRoleState(savedView);
    } catch {}

    // /api/admin/me からプラットフォームオーナー判定を取得。
    // PR-AUTH2: true だけでなく false も明示反映し、!ok / catch でも false に確定させる
    // （stale true / stale false を残さない）。cache:"no-store" でブラウザ側の再利用も防ぐ。
    fetch("/api/admin/me", { headers: { ...getAuthHeaders() }, cache: "no-store" })
      .then((r) => {
        if (!r.ok) return null;
        return r.json() as Promise<{ data?: { is_platform_owner?: boolean } }>;
      })
      .then((body) => {
        // body=null（!ok）や undefined のときも false に確定（platformOwnerFromResponseBody）。
        setIsPlatformOwner(platformOwnerFromResponseBody(body));
      })
      .catch(() => {
        // ネットワークエラー時は一般ユーザー扱い（false に確定）。
        setIsPlatformOwner(false);
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

  /**
   * `/oas` 表示確認モードの視点を切り替える（null = platform owner 既定に戻す）。
   * UI 表示専用。実権限・API には一切影響しない。
   */
  const setPreviewViewRole = useCallback((role: OasViewRole | null) => {
    // "platform_owner" は「preview なし（実 platform owner 視点）」と同義なので null に正規化する。
    const next = role === "platform_owner" ? null : role;
    setPreviewViewRoleState(next);
    try {
      if (next) localStorage.setItem(OAS_VIEW_PREVIEW_KEY, next);
      else localStorage.removeItem(OAS_VIEW_PREVIEW_KEY);
    } catch {
      // localStorage 使用不可環境では無視
    }
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
    /** `/oas` 表示確認モードで選択中の視点（null = platform owner 既定） */
    previewViewRole,
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
    /** `/oas` 表示確認モードの視点を切り替える（null / "platform_owner" でリセット） */
    setPreviewViewRole,
  };
}
