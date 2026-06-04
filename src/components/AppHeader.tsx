"use client";

// src/components/AppHeader.tsx
// グローバルヘッダー。
// /login / /access-denied では非表示。Supabase 認証済み時はログアウトボタンを表示。
//
// 権限表示方針:
//   - ヘッダーには「現在選択中のOAの workspace role」を表示する
//   - owner 判定は workspace role === "owner" に統一
//   - owner → 「スタジオ管理」 / 非 owner → 「気づいた点を送る」

import { Suspense, useState, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useTesterMode } from "@/hooks/useTesterMode";
import { useWorkspaceRole } from "@/hooks/useWorkspaceRole";
import { parsePreviewRole, type PreviewRole } from "@/lib/access-preview";
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

/**
 * URL `?previewRole` を `useSearchParams` で reactive に監視し、コールバック経由で
 * 親 (AppHeader) に伝える小さな client component。
 *
 * 役割:
 *   - AppHeader が直接 `useSearchParams` を呼ぶと /404 / /access-denied の static
 *     prerender が「Suspense 境界が必要」エラーで失敗する
 *   - 本 reader を `<Suspense fallback={null}>` でラップすることで AppHeader 本体は
 *     useSearchParams に依存せず済み、prerender に影響なし
 *   - URL ?previewRole が変化すると useSearchParams が再評価され、effect で
 *     onChange を呼んで AppHeader を再レンダリングさせる
 */
function PreviewRoleReader({ onChange }: { onChange: (role: PreviewRole | null) => void }) {
  const sp = useSearchParams();
  const raw = sp.get("previewRole");
  useEffect(() => {
    onChange(parsePreviewRole(raw));
  }, [raw, onChange]);
  return null;
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

  // 表示確認モード (= AccessPreviewBar) で「表示確認権限」を非 owner にした場合、
  // 右上 CTA も連動して「気づいたことを伝える」に切り替える (= UI 確認用)。
  // 実権限は引き続き bypass されるため、操作は壊れない。
  //
  // 実装メモ: AppHeader は root layout 配下にあり、/404 / /access-denied が
  // static prerender される。`useSearchParams` を直に使うと「Suspense 境界が必要」
  // エラーで build が落ちるため、useSearchParams を呼ぶ最小限の reader を
  // <Suspense fallback={null}> でラップし、コールバック経由で AppHeader 本体に
  // preview role を伝える。これにより URL ?previewRole 変更時に reactive 追従する。
  const [previewRole, setPreviewRole] = useState<PreviewRole | null>(null);
  // canUsePreviewMode は実 owner のみ。非 owner が URL を偽装しても preview 適用しない。
  const canUsePreviewModeForHeader = isOwner;
  const isPreviewingRole = canUsePreviewModeForHeader && previewRole !== null && previewRole !== workspaceRole;
  const effectiveRoleForHeader: PreviewRole | Role | null =
    canUsePreviewModeForHeader && previewRole ? previewRole : workspaceRole;

  // ── OA 横断 owner 判定（OA ページ外でも CTA を切り替えるため）─────
  // /api/oas の my_role を見て、1つでも owner の OA があれば isAnyOaOwner = true
  // perf: 全ページ mount 時に毎回 fetch していた → sessionStorage に短 TTL でキャッシュ。
  //
  // セキュリティ:
  //   - cache key に userId を含める (= 別ユーザーは別 entry / 共有同一ブラウザでも汚染しない)
  //   - onAuthStateChange (= ログアウト / ユーザー切替) で `ws_app_header_is_any_oa_owner_`
  //     prefix の全 entry を clear (= 二重防御)
  //   - TTL 60 秒に短縮 (= 元 5 分から短く / OA 作成・退会後の反映遅延を最大 60 秒に抑制)
  //
  // 互換: 古い key (= "ws_app_header_is_any_oa_owner") を起動時に削除 (= migrate)。
  const CACHE_KEY_PREFIX = "ws_app_header_is_any_oa_owner_";
  const LEGACY_CACHE_KEY = "ws_app_header_is_any_oa_owner";
  const CACHE_TTL_MS     = 60 * 1000; // 60 秒
  useEffect(() => {
    const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return;

    let cancelled = false;
    const supabase = createSupabaseBrowserClient();

    // 古い user-agnostic key は migration として 1 度削除する。
    try { sessionStorage.removeItem(LEGACY_CACHE_KEY); } catch { /* ignore */ }

    function clearAllOwnerCacheEntries(): void {
      try {
        const toDel: string[] = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith(CACHE_KEY_PREFIX)) toDel.push(k);
        }
        for (const k of toDel) sessionStorage.removeItem(k);
      } catch { /* ignore */ }
    }

    // 認証状態の変化 (= ログイン / ログアウト / ユーザー切替) で cache を全消去。
    // これにより別ユーザーが直前に取得した結果を、新ユーザーが見ることが無い。
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, _session) => {
      clearAllOwnerCacheEntries();
      setIsAnyOaOwner(false); // state も初期化 (= ログアウト直後に owner CTA を残さない)
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const userId = data.session?.user?.id;
      if (!userId) return; // 未ログインなら判定不要

      const cacheKey = CACHE_KEY_PREFIX + userId;
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as { v: boolean; t: number };
          if (parsed && typeof parsed.t === "number" && Date.now() - parsed.t < CACHE_TTL_MS) {
            if (parsed.v) setIsAnyOaOwner(true);
            return;
          }
        }
      } catch { /* ignore parse error */ }

      fetch("/api/oas?limit=100", { headers: { ...getAuthHeaders() }, cache: "no-store" })
        .then((r) => r.ok ? r.json() : null)
        .then((body) => {
          if (cancelled) return;
          const isOwner = !!body?.data?.some?.((oa: { my_role?: string }) => oa.my_role === "owner");
          if (isOwner) setIsAnyOaOwner(true);
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify({ v: isOwner, t: Date.now() }));
          } catch { /* quota / private mode */ }
        })
        .catch(() => {});
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // バッジに表示する role。OA 内かつ表示確認モード中は preview role を反映する
  // (= CTA の切替と整合させ、UI 一致を保つ。Role 型に変換可能な値のみ受け入れる)。
  const displayRole: Role | null = currentOaId
    ? (isPreviewingRole && effectiveRoleForHeader && effectiveRoleForHeader !== "client_operator" && effectiveRoleForHeader !== "operator"
        ? (effectiveRoleForHeader as Role)
        : workspaceRole)
    : (isAnyOaOwner ? "owner" : null);

  // owner 判定: workspace owner（OA ページ内）または OA 横断 owner（OA ページ外）。
  // ただし表示確認モードで role を非 owner に切り替えている場合は、その表示用 role を優先する
  // (= 非 owner ユーザーから見た UI 確認を可能にする)。実権限は plan-guard / rbac で別途扱う。
  const isEffectiveOwner = currentOaId
    ? (isPreviewingRole ? effectiveRoleForHeader === "owner" : isOwner)
    : isAnyOaOwner;

  // スタジオ管理のリンク先: OA ページ内なら OA 設定、それ以外はスタジオ管理トップ
  const studioHref = "/admin";

  return (
    <>
      {/* URL ?previewRole の変更を reactive に監視する。Suspense でラップして
          /404 / /access-denied 等の static prerender でも build を通す。 */}
      <Suspense fallback={null}>
        <PreviewRoleReader onChange={setPreviewRole} />
      </Suspense>
      <header>
        <div className="container">
          {/* ── サービスタイトル ── */}
          <h1>
            <a href={homeHref} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="header-brand">WHALE STUDIO</span>
              {/* セパレータ / サブタイトルは SP では非表示 (= ヘッダー高さ・横幅を圧迫するため)。
                  sm (= 640px+) で表示。 */}
              <span className="header-sep hidden sm:inline">|</span>
              <span className="header-sub hidden sm:inline">
                LINEでつくる物語体験
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
          {/* AccessPreviewControls は AppShell でヘッダー直下の独立バーとして表示する。
              既存ヘッダーの横並び (= ロゴ / 副題 / オーナーバッジ / ユーザー名 / ログアウト /
              スタジオ管理) の高さ・折り返しを崩さないため。 */}

          {/* ── ユーザー名（ログイン済み時のみ / SP では非表示 = ヘッダー横幅圧迫の主因） ── */}
          {loggedIn && (
            <a
              href="/settings/profile"
              className="hidden sm:inline-flex"
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
              {/* SP では「ログアウト」全文を維持しつつ font / padding は既存のまま (= 小サイズ済) */}
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
              {/* SP では「管理」に短縮、PC では従来の「🏠 スタジオ管理」を維持。
                  遷移先 / 表示条件は不変 (= 同一 <a href={studioHref}>)。 */}
              <span className="hidden sm:inline">🏠 スタジオ管理</span>
              <span className="sm:hidden">管理</span>
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
              {/* SP では「気づき」に短縮、PC では従来の「気づいたことを伝える」を維持。
                  onClick / 遷移先は不変。 */}
              <span className="hidden sm:inline">気づいたことを伝える</span>
              <span className="sm:hidden">気づき</span>
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
