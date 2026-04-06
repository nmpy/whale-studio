"use client";

// src/components/AppHeader.tsx
// グローバルヘッダー。
// /login / /access-denied では非表示。Supabase 認証済み時はログアウトボタンを表示。
//
// 権限表示方針:
//   - ヘッダーには「現在選択中のOAの workspace role」を表示する
//   - platform role はヘッダーに出さない（管理機能の出し分けのみに使用）
//   - platform owner には「オーナー」バッジを表示し、クリックで権限プレビューを切り替えられる
//   - platform owner には「スタジオ管理」ボタンを表示する（非 owner は「気づいた点を送る」）

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useTesterMode } from "@/hooks/useTesterMode";
import { usePlatformRole } from "@/hooks/usePlatformRole";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { RoleBadge } from "@/components/PermissionGuard";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Role } from "@/lib/types/permissions";

// FeedbackModal は大きいので dynamic import でコード分割
const FeedbackModal = dynamic(() => import("@/components/FeedbackModal"), { ssr: false });

// AppHeader を表示しないルート
const HEADER_HIDDEN_ROUTES = ["/login", "/access-denied"];

// ── 権限プレビュードロップダウン用ロール定義 ────────────────────────
const WORKSPACE_ROLE_INFO: Array<{
  role:   Role;
  label:  string;
  desc:   string;
  bg:     string;
  color:  string;
  border: string;
}> = [
  { role: "owner",  label: "オーナー", desc: "すべて操作可能",  bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  { role: "admin",  label: "管理者",   desc: "管理・招待可能",  bg: "#faf5ff", color: "#7c3aed", border: "#ddd6fe" },
  { role: "editor", label: "編集者",   desc: "制作編集可能",    bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" },
  { role: "viewer", label: "閲覧者",   desc: "閲覧のみ",        bg: "#f9fafb", color: "#6b7280", border: "#e5e7eb" },
];

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
  const {
    isPlatformOwner,
    previewWsRole,
    setPreviewWsRole,
    isPreviewingWsRole,
  } = usePlatformRole();

  const [feedbackOpen,     setFeedbackOpen]     = useState(false);
  const [loggedIn,         setLoggedIn]         = useState(false);
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  // pricing ページ起点で開いたときの流入元（"header" / "banner" 等）
  const [pricingSource,    setPricingSource]    = useState<string | undefined>(undefined);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // 現在の OA ID をパスから取得
  const currentOaId = extractOaId(pathname);

  // 現在の OA の workspace role を取得（OA ページ外では workspaceId="" → role=null）
  const { role: workspaceRole, loading: roleLoading } = useWorkspaceRole(currentOaId);

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

  // ── ドロップダウン外クリックで閉じる ─────────────────────────────
  useEffect(() => {
    if (!showRoleDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowRoleDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showRoleDropdown]);

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

  // OA ページにいて role が取得済みの場合のみ workspace role バッジを表示
  const showRoleBadge = !!currentOaId && !roleLoading && workspaceRole !== null;

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

          {/* ── platform owner バッジ（クリックで権限プレビュードロップダウン） ── */}
          {isPlatformOwner && (
            <div
              ref={dropdownRef}
              style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
            >
              <button
                type="button"
                onClick={() => setShowRoleDropdown((v) => !v)}
                style={{
                  display:      "inline-flex",
                  alignItems:   "center",
                  gap:          4,
                  fontSize:     11,
                  fontWeight:   700,
                  padding:      "3px 10px",
                  borderRadius: 20,
                  cursor:       "pointer",
                  border:       isPreviewingWsRole
                    ? "1.5px solid #f59e0b"
                    : "1.5px solid #bfdbfe",
                  background:   isPreviewingWsRole ? "#fffbeb" : "#eff6ff",
                  color:        isPreviewingWsRole ? "#92400e" : "#1d4ed8",
                  transition:   "all .15s",
                  whiteSpace:   "nowrap",
                  lineHeight:   1,
                }}
                aria-label="権限プレビューを切り替える"
                aria-haspopup="true"
                aria-expanded={showRoleDropdown}
              >
                {isPreviewingWsRole ? (
                  <>
                    👁 {WORKSPACE_ROLE_INFO.find((r) => r.role === previewWsRole)?.label ?? "プレビュー"}
                    <span style={{ fontSize: 9, opacity: 0.7 }}>▼</span>
                  </>
                ) : (
                  <>
                    ⚡ オーナー
                    <span style={{ fontSize: 9, opacity: 0.7 }}>▼</span>
                  </>
                )}
              </button>

              {/* ── 権限プレビュードロップダウン ── */}
              {showRoleDropdown && (
                <div
                  role="menu"
                  style={{
                    position:     "absolute",
                    top:          "calc(100% + 8px)",
                    left:         0,
                    minWidth:     240,
                    background:   "#fff",
                    border:       "1px solid #e5e7eb",
                    borderRadius: 10,
                    boxShadow:    "0 8px 24px rgba(0,0,0,0.12)",
                    zIndex:       1000,
                    overflow:     "hidden",
                  }}
                >
                  {/* ドロップダウンヘッダー */}
                  <div style={{
                    padding:       "10px 14px 8px",
                    fontSize:      11,
                    fontWeight:    700,
                    color:         "#6b7280",
                    letterSpacing: ".04em",
                    textTransform: "uppercase",
                    borderBottom:  "1px solid #f3f4f6",
                    display:       "flex",
                    alignItems:    "center",
                    gap:           6,
                  }}>
                    <span>👁</span> 権限プレビュー
                  </div>

                  {/* ロール一覧 */}
                  {WORKSPACE_ROLE_INFO.map(({ role, label, desc, bg, color, border }) => {
                    const isCurrentPreview = isPreviewingWsRole && previewWsRole === role;
                    const isRealOwner      = !isPreviewingWsRole && role === "owner";
                    const isActive         = isCurrentPreview || isRealOwner;

                    return (
                      <button
                        key={role}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          if (isActive && role === "owner") {
                            // owner を再クリック or デフォルト owner → 何もしない（解除はフッター）
                          } else if (isActive) {
                            // 現在プレビュー中のロールを再クリック → プレビュー解除
                            setPreviewWsRole(null);
                          } else {
                            // プレビュー切り替え（owner を選んでも「プレビュー」扱い）
                            setPreviewWsRole(role);
                          }
                          setShowRoleDropdown(false);
                        }}
                        style={{
                          width:        "100%",
                          display:      "flex",
                          alignItems:   "center",
                          gap:          10,
                          padding:      "9px 14px",
                          background:   isActive ? `${bg}99` : "transparent",
                          border:       "none",
                          cursor:       "pointer",
                          textAlign:    "left",
                          borderBottom: "1px solid #f9fafb",
                          transition:   "background .1s",
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) e.currentTarget.style.background = "#f9fafb";
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) e.currentTarget.style.background = "transparent";
                        }}
                      >
                        {/* ロールバッジ */}
                        <span style={{
                          display:      "inline-block",
                          padding:      "2px 9px",
                          borderRadius: 20,
                          fontSize:     10,
                          fontWeight:   700,
                          background:   bg,
                          color,
                          border:       `1px solid ${border}`,
                          whiteSpace:   "nowrap",
                          flexShrink:   0,
                        }}>
                          {label}
                        </span>

                        {/* 説明 */}
                        <span style={{ fontSize: 12, color: "#374151", flex: 1 }}>
                          {desc}
                        </span>

                        {/* チェックマーク */}
                      </button>
                    );
                  })}

                  {/* プレビュー中の場合のみ解除フッターを表示 */}
                  {isPreviewingWsRole && (
                    <div style={{ padding: "7px 14px", borderTop: "1px solid #f3f4f6" }}>
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewWsRole(null);
                          setShowRoleDropdown(false);
                        }}
                        style={{
                          width:      "100%",
                          padding:    "5px",
                          fontSize:   11,
                          fontWeight: 600,
                          color:      "#9ca3af",
                          background: "none",
                          border:     "none",
                          cursor:     "pointer",
                          textAlign:  "center",
                        }}
                      >
                        プレビューを解除する
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── 現在の OA の workspace role バッジ ── */}
          {showRoleBadge && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
              <RoleBadge role={workspaceRole as Role} />
            </div>
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

          {/* ── platform owner → スタジオ管理 / 非 owner → 気づいた点を送る ── */}
          {isPlatformOwner ? (
            <a
              href="/admin/announcements"
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
              aria-label="気づいた点を送る"
            >
              気づいた点を送る
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
