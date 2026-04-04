"use client";

// src/components/AppHeader.tsx
// グローバルヘッダー。フィードバックボタンを右上に常設。
// /login / /access-denied では非表示。Supabase 認証済み時はログアウトボタンを表示。

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useTesterMode } from "@/hooks/useTesterMode";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// FeedbackModal は大きいので dynamic import でコード分割
const FeedbackModal = dynamic(() => import("@/components/FeedbackModal"), { ssr: false });

// AppHeader を表示しないルート
const HEADER_HIDDEN_ROUTES = ["/login", "/access-denied"];

export default function AppHeader() {
  const pathname = usePathname();
  const { isTester, testerOaId } = useTesterMode();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [loggedIn,     setLoggedIn]     = useState(false);

  // ── ログイン状態を取得（Supabase 設定済みのときのみ） ─────────────
  // ⚠ hooks はすべての早期 return より前に宣言する必要がある
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
    const handler = () => setFeedbackOpen(true);
    window.addEventListener("open-feedback-modal", handler);
    return () => window.removeEventListener("open-feedback-modal", handler);
  }, []);

  // ── ヘッダー非表示ルート（hooks より後でOK） ─────────────────────
  if (HEADER_HIDDEN_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "?"))) {
    return null;
  }

  const homeHref = isTester && testerOaId ? `/tester/${testerOaId}` : "/";

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <>
      <header>
        <div className="container">
          <h1>
            <a href={homeHref}>
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

          {/* ── フィードバックボタン ── */}
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
              e.currentTarget.style.background  = "#e5e7eb";
              e.currentTarget.style.borderColor = "#d1d5db";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background  = "#f3f4f6";
              e.currentTarget.style.borderColor = "#e5e7eb";
            }}
            aria-label="気づいた点を送る"
          >
            <span style={{ fontSize: 14 }}>💬</span>
            気づいた点を送る
          </button>
        </div>
      </header>

      {/* フィードバックモーダル（開いているときのみマウント） */}
      {feedbackOpen && (
        <FeedbackModal
          pathname={pathname}
          onClose={() => setFeedbackOpen(false)}
        />
      )}
    </>
  );
}
