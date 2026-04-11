"use client";

// src/components/AppHeader.tsx
// グローバルヘッダー。
// /login / /access-denied では非表示。Supabase 認証済み時はログアウトボタンを表示。
//
// 権限表示方針:
//   - ヘッダーには「現在選択中のOAの workspace role」を表示する
//   - owner 判定は workspace role === "owner" に統一
//   - owner → 「スタジオ管理」 / 非 owner → 「気づいた点を送る」

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useTesterMode } from "@/hooks/useTesterMode";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { getAuthHeaders } from "@/lib/api-client";
import { RoleBadge } from "@/components/PermissionGuard";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { useToast } from "@/components/Toast";
import { getDisplayName } from "@/lib/user-display";
import type { Role } from "@/lib/types/permissions";

// FeedbackModal は大きいので dynamic import でコード分割
const FeedbackModal = dynamic(() => import("@/components/FeedbackModal"), { ssr: false });

// AppHeader を表示しないルート
const HEADER_HIDDEN_ROUTES = ["/login", "/access-denied"];

/**
 * pathname から OA ID を抽出する。
 * /oas/[id]/... の形式に対応。
 */
function extractOaId(pathname: string): string {
  const oasMatch = pathname.match(/^\/oas\/([^/]+)/);
  if (oasMatch) return oasMatch[1];
  return "";
}

export default function AppHeader() {
  const pathname = usePathname();
  const { isTester, testerOaId } = useTesterMode();

  const [feedbackOpen,     setFeedbackOpen]     = useState(false);
  const [loggedIn,         setLoggedIn]         = useState(false);
  const [isAnyOaOwner,     setIsAnyOaOwner]     = useState(false);
  const { profile, loading: profileLoading }    = useProfile();
  const { showToast }                           = useToast();
  const displayName                             = getDisplayName(profile);
  // pricing ページ起点で開いたときの流入元（"header" / "banner" 等）
  const [pricingSource,    setPricingSource]    = useState<string | undefined>(undefined);

  // 現在の OA ID をパスから取得
  const currentOaId = extractOaId(pathname);

  // 現在の OA の workspace role を取得（OA ページ外では workspaceId="" → role=null）
  const { role: workspaceRole, loading: roleLoading, isOwner } = useWorkspaceRole(currentOaId);

  // ── OA 横断 owner 判定（OA ページ外でも CTA を切り替えるため）─────
  // /api/oas の my_role を見て、1つでも owner の OA があれば isAnyOaOwner = true
  useEffect(() => {
    fetch("/api/oas?limit=100", { headers: { ...getAuthHeaders() }, cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((body) => {
        if (body?.data?.some((oa: { my_role?: string }) => oa.my_role === "owner")) {
          setIsAnyOaOwner(true);
        }
      })
      .catch(() => {});
  }, []);

  // ── ログイン状態を取得（Supabase 設定済みのときのみ） ─────────────
  useEffect(() => {
    const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return;

    const supabase = createSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      setLoggedIn(!!data.session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setLoggedIn(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── 初回ログイン時の「ようこそ」トースト ──────────────────────────
  useEffect(() => {
    if (!loggedIn || profileLoading || !profile) return;
    const key = `welcome_shown_${profile.user_id}`;
    try {
      if (!localStorage.getItem(key)) {
        showToast(`ようこそ、${getDisplayName(profile)}さん`, "success");
        localStorage.setItem(key, "1");
      }
    } catch {
      // localStorage 無効な環境はスキップ
    }
  }, [loggedIn, profileLoading, profile, showToast]);

  // ── フィードバックモーダル: 外部イベントで開く ─────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      // pricing ページから開く場合は detail.pricingSource が付いてくる
      const detail = (e as CustomEvent<{ pricingSource?: string }>).detail;
      setPricingSource(detail?.pricingSource ?? undefined);
      setFeedbackOpen(true);
    };
    window.addEventListener("open-feedback-modal", handler);
    return () => window.removeEventListener("open-feedback-modal", handler);
  }, []);

  // ── ヘッダー非表示ルート ─────────────────────────────────────────
  if (HEADER_HIDDEN_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "?"))) {
    return null;
  }

  const homeHref = isTester && testerOaId ? `/tester/${testerOaId}` : "/";

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  // role バッジ表示: OA ページ内は workspace role、OA ページ外は isAnyOaOwner
  const showRoleBadge = currentOaId
    ? (!roleLoading && workspaceRole !== null)
    : isAnyOaOwner;

  // バッジに表示する role
  const displayRole: Role | null = currentOaId ? workspaceRole : (isAnyOaOwner ? "owner" : null);

  // owner 判定: workspace owner（OA ページ内）または OA 横断 owner（OA ページ外）
  const isEffectiveOwner = isOwner || isAnyOaOwner;

  // スタジオ管理のリンク先: OA ページ内なら OA 設定、それ以外は admin
  const studioHref = currentOaId
    ? `/oas/${currentOaId}/settings`
    : "/admin/announcements";

  return (
    <>
      <header>
        <div className="container">
          {/* ── サービスタイトル ── */}
          <h1>
            <a href={homeHref} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="header-brand">WHALE STUDIO</span>
              <span className="header-sep">|</span>
              <span className="header-sub">
                LINEでつくる物語体験 β版
                {isTester && (
                  <span style={{ color: "#9ca3af", fontSize: 12, fontWeight: 400, marginLeft: 4 }}>
                    （テスターモード）
                  </span>
                )}
              </span>
            </a>
          </h1>

          {/* ── role バッジ ── */}
          {showRoleBadge && displayRole && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
              <RoleBadge role={displayRole} />
            </div>
          )}

          {/* ── ユーザー名（ログイン済み時のみ） ── */}
          {loggedIn && (
            <a
              href="/settings/profile"
              style={{
                fontSize:       12,
                fontWeight:     600,
                color:          "#374151",
                whiteSpace:     "nowrap",
                overflow:       "hidden",
                textOverflow:   "ellipsis",
                maxWidth:       120,
                flexShrink:     1,
                textDecoration: "none",
              }}
              title={`${displayName} — プロフィール設定`}
            >
              {displayName}
            </a>
          )}

          {/* ── ログアウトボタン（Supabase 認証済み時のみ） ── */}
          {loggedIn && (
            <button
              type="button"
              onClick={handleLogout}
              style={{
                display:      "flex",
                alignItems:   "center",
                padding:      "5px 13px",
                fontSize:     12,
                fontWeight:   600,
                color:        "#6b7280",
                background:   "none",
                border:       "1.5px solid #e5e7eb",
                borderRadius: 20,
                cursor:       "pointer",
                transition:   "border-color 0.15s, color 0.15s",
                whiteSpace:   "nowrap",
                flexShrink:   0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#d1d5db";
                e.currentTarget.style.color       = "#374151";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#e5e7eb";
                e.currentTarget.style.color       = "#6b7280";
              }}
              aria-label="ログアウト"
            >
              ログアウト
            </button>
          )}

          {/* ── owner → スタジオ管理 / 非 owner → 気づいた点を送る ── */}
          {isEffectiveOwner ? (
            <a
              href={studioHref}
              style={{
                marginLeft:     "auto",
                display:        "inline-flex",
                alignItems:     "center",
                gap:            5,
                padding:        "5px 14px",
                fontSize:       12,
                fontWeight:     700,
                color:          "#fff",
                background:     "var(--color-primary, #2F6F5E)",
                border:         "1.5px solid transparent",
                borderRadius:   20,
                textDecoration: "none",
                whiteSpace:     "nowrap",
                flexShrink:     0,
                transition:     "opacity .15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
            >
              🏠 スタジオ管理
            </a>
          ) : (
            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              style={{
                marginLeft:   "auto",
                display:      "flex",
                alignItems:   "center",
                gap:          5,
                padding:      "5px 13px",
                fontSize:     12,
                fontWeight:   600,
                color:        "#374151",
                background:   "#f3f4f6",
                border:       "1.5px solid #e5e7eb",
                borderRadius: 20,
                cursor:       "pointer",
                transition:   "background 0.15s, border-color 0.15s",
                whiteSpace:   "nowrap",
                flexShrink:   0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background   = "#e5e7eb";
                e.currentTarget.style.borderColor  = "#d1d5db";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background   = "#f3f4f6";
                e.currentTarget.style.borderColor  = "#e5e7eb";
              }}
              aria-label="気づいたことを伝える"
            >
              気づいたことを伝える
            </button>
          )}
        </div>
      </header>

      {/* フィードバックモーダル（開いているときのみマウント） */}
      {feedbackOpen && (
        <FeedbackModal
          pathname={pathname}
          pricingSource={pricingSource}
          onClose={() => { setFeedbackOpen(false); setPricingSource(undefined); }}
        />
      )}
    </>
  );
}
