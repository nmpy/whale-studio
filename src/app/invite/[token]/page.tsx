"use client";
// src/app/invite/[token]/page.tsx
//
// 招待受け入れページ（v4）
//
// ■ 状態一覧:
//   loading        — トークン検証・セッション確認中
//   invalid        — トークン不存在 / 受け入れ済み（再利用不可）
//   expired        — 有効期限切れ
//   already_joined — ログイン済みかつ対象 OA のメンバー
//   error          — ネットワーク / 予期しないエラー（リトライ可）
//   register       — ① 未登録ユーザー: アカウント登録フォーム
//   confirm        — ③ ログイン済みユーザー: 参加確認
//   email_mismatch — ③' ログイン済み・メール不一致
//   confirm_email  — Supabase メール確認待ち（Email Confirmations ON の場合）
//   registered     — 登録 + 招待承諾 完了
//   joined         — ログイン済みユーザーによる招待承諾 完了
//
// ■ 未ログイン時の遷移:
//   一律 → register（招待専用の登録/ログイン統合画面）
//   ※ is_registered はアドバイザリ情報として登録済みユーザーへの案内表示に使用
//
// ■ already_joined の検出:
//   accept() が 409 を返したとき（冪等性: 致命的エラーではなく成功扱いに近い）
//
// ■ E2Eチェック対象ケース（開発環境では診断ログで確認できる）:
//   Case 1: 未登録               → register（登録フォーム）
//   Case 2: 登録済み未ログイン    → register（ログイン導線を併記）
//   Case 3: ログイン済み一致      → confirm → joined
//   Case 4: email不一致          → email_mismatch
//   Case 5: 期限切れ             → expired
//   Case 6: 無効トークン(404)    → invalid
//   Case 7: 参加済み409          → already_joined
//
// ■ /invite/** は middleware の PUBLIC ルートとして設定済み

import { Suspense, useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { invitationApi, type InvitationDetail } from "@/lib/api-client";
import { ROLE_LABELS } from "@/lib/types/permissions";

// ── 状態型 ──────────────────────────────────────────────────────────
type InviteState =
  | { status: "loading" }
  | { status: "invalid" }
  | { status: "expired";        invitation: InvitationDetail }
  | { status: "already_joined"; oaId: string; oaName: string }
  | { status: "error";          message: string }
  | { status: "register";       invitation: InvitationDetail }
  | { status: "confirm";        invitation: InvitationDetail; userEmail: string | null }
  | { status: "email_mismatch"; invitation: InvitationDetail; userEmail: string }
  | { status: "confirm_email";  invitation: InvitationDetail }
  | { status: "registered";     oaName: string }
  | { status: "joined";         oaId: string; oaName: string };

// ── 開発環境用診断ログ ───────────────────────────────────────────────
function devLog(msg: string, data?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "development") {
    console.log(
      `%c[InvitePage] ${msg}`,
      "color:#2F6F5E;font-weight:bold",
      data ?? ""
    );
  }
}

// ────────────────────────────────────────────────────────────────────
// メインコンポーネント
// ────────────────────────────────────────────────────────────────────
function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const token  = typeof params.token === "string"
    ? params.token
    : Array.isArray(params.token) ? params.token[0] : "";

  const [state, setState] = useState<InviteState>({ status: "loading" });

  // ── 初期化: トークン検証 + ユーザー状態判定 ────────────────────
  const init = useCallback(async () => {
    if (!token) {
      devLog("Case 6: token なし → invalid");
      setState({ status: "invalid" });
      return;
    }

    setState({ status: "loading" });
    devLog("init() 開始", { token: token.slice(0, 8) + "..." });

    // ── 1. トークン検証（認証不要エンドポイント） ───────────────
    let invitation: InvitationDetail;
    try {
      invitation = await invitationApi.validate(token);
      devLog("トークン検証 OK", {
        oa_name:       invitation.oa_name,
        email:         invitation.email,
        is_expired:    invitation.is_expired,
        is_accepted:   invitation.is_accepted,
        is_registered: invitation.is_registered,
      });
    } catch (err: unknown) {
      const anyErr = err as { status?: number; message?: string };
      if (anyErr?.status === 404) {
        devLog("Case 6: 404 → invalid");
        setState({ status: "invalid" });
      } else {
        devLog("error: API 障害 / ネットワークエラー", { status: anyErr?.status, msg: anyErr?.message });
        setState({ status: "error", message: anyErr?.message ?? "招待情報を読み込めませんでした" });
      }
      return;
    }

    // ── 2. APIフラグによる早期分岐 ────────────────────────────
    if (invitation.is_accepted) {
      devLog("Case 6(accepted): is_accepted → invalid（再利用不可）");
      setState({ status: "invalid" });
      return;
    }
    if (invitation.is_expired) {
      devLog("Case 5: is_expired → expired");
      setState({ status: "expired", invitation });
      return;
    }

    // ── 3. Supabase 未設定（開発バイパスモード） ───────────────
    const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      devLog("Supabase 未設定: バイパスモード → confirm");
      setState({ status: "confirm", invitation, userEmail: null });
      return;
    }

    // ── 4. セッション確認 ──────────────────────────────────────
    let session: Awaited<ReturnType<ReturnType<typeof createSupabaseBrowserClient>["auth"]["getSession"]>>["data"]["session"];
    try {
      const supabase        = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      session = data.session;
      devLog("セッション確認", {
        hasSession: !!session,
        sessionEmail: session?.user?.email ?? null,
      });
    } catch {
      devLog("error: セッション取得失敗");
      setState({ status: "error", message: "セッション情報を取得できませんでした" });
      return;
    }

    // ── 5. ③ ログイン済み ────────────────────────────────────
    if (session) {
      const userEmail = session.user.email ?? null;
      if (userEmail && invitation.email !== userEmail) {
        devLog("Case 4: ログイン済み・email不一致 → email_mismatch", {
          sessionEmail: userEmail,
          inviteEmail:  invitation.email,
        });
        setState({ status: "email_mismatch", invitation, userEmail });
      } else {
        devLog("Case 3: ログイン済み・email一致 → confirm");
        setState({ status: "confirm", invitation, userEmail });
      }
      return;
    }

    // ── 6. 未ログイン → 一律 register（招待専用画面） ─────────
    // is_registered は register 画面内で「既にアカウントをお持ちの方」案内の表示切替に使用。
    // /login にリダイレクトしないことで、パスワード入力画面に迷い込む問題を防ぐ。
    devLog(invitation.is_registered ? "Case 2: 登録済み未ログイン → register（ログイン導線併記）" : "Case 1: 未登録 → register");
    setState({ status: "register", invitation });
  }, [token]);

  useEffect(() => { init(); }, [init]);

  // ── 登録完了後 → /login へ自動リダイレクト ────────────────────
  useEffect(() => {
    if (state.status === "registered") {
      const t = setTimeout(() => router.push("/login"), 3000);
      return () => clearTimeout(t);
    }
  }, [state, router]);

  // ── 招待承諾後 → /oas/[id] へ自動リダイレクト ─────────────────
  useEffect(() => {
    if (state.status === "joined") {
      const t = setTimeout(() => router.push(`/oas/${state.oaId}`), 2000);
      return () => clearTimeout(t);
    }
  }, [state, router]);

  // ────────────────────────────────────────────────────────────────
  // レンダリング
  // ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight:      "100vh",
      display:        "flex",
      alignItems:     "center",
      justifyContent: "center",
      background:     "#f8fafc",
      padding:        "0 16px",
    }}>
      <div className="card" style={{ width: 440, padding: "40px 36px" }}>

        {/* ── ブランド ── */}
        <p style={{ fontSize: 12, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.08em", marginBottom: 24 }}>
          WHALE STUDIO
        </p>

        {/* ── ローディング ── */}
        {state.status === "loading" && (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: "24px 0" }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
            <p style={{ fontSize: 14 }}>招待情報を確認しています...</p>
          </div>
        )}

        {/* ── invalid ── */}
        {state.status === "invalid" && (
          <ErrorCard
            icon="🔗"
            title="この招待リンクはご利用いただけません"
            body="この招待リンクは存在しないか、現在はご利用いただけません。お手数ですが、招待元の管理者に最新の招待リンクをご確認ください。"
            actions={[
              { label: "ログイン画面へ", href: "/login", primary: true },
              { label: "トップへ戻る",   href: "/",     primary: false },
            ]}
          />
        )}

        {/* ── expired ── */}
        {state.status === "expired" && (
          <ErrorCard
            icon="⏰"
            title="招待リンクの期限が切れています"
            body="この招待リンクは有効期限を過ぎているため、参加できません。必要な場合は、招待元の管理者に新しい招待リンクの発行をご依頼ください。"
            actions={[
              { label: "ログイン画面へ", href: "/login", primary: true },
              { label: "トップへ戻る",   href: "/",     primary: false },
            ]}
          />
        )}

        {/* ── already_joined ── */}
        {state.status === "already_joined" && (
          <div style={{ textAlign: "center" }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 10 }}>
              すでに参加済みです
            </h2>
            <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.8, marginBottom: 28 }}>
              この招待はすでに受け付けられています。そのままアカウントページへ進めます。
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: "100%" }}
              onClick={() => router.push(`/oas/${state.oaId}`)}
            >
              アカウントを開く
            </button>
          </div>
        )}

        {/* ── error ── */}
        {state.status === "error" && (
          <div style={{ textAlign: "center" }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 10 }}>
              招待情報を読み込めませんでした
            </h2>
            <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.8, marginBottom: 20 }}>
              通信状況をご確認のうえ、もう一度お試しください。時間をおいても改善しない場合は、再度アクセスをお試しください。
            </p>
            {process.env.NODE_ENV === "development" && (
              <div style={{
                background:   "#fef2f2",
                border:       "1px solid #fecaca",
                borderRadius: 6,
                padding:      "6px 12px",
                fontSize:     11,
                color:        "#dc2626",
                fontFamily:   "monospace",
                marginBottom: 16,
                textAlign:    "left",
                wordBreak:    "break-all",
              }}>
                [dev] {state.message}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={init}
              >
                再読み込み
              </button>
              <a href="/login" className="btn btn-ghost" style={{ textDecoration: "none" }}>
                ログイン画面へ
              </a>
            </div>
          </div>
        )}

        {/* ── ① register: 招待専用の登録/ログイン画面 ── */}
        {state.status === "register" && (
          <RegisterForm
            token={token}
            invitation={state.invitation}
            isRegistered={state.invitation.is_registered}
            onRegistered={(oaName) => setState({ status: "registered", oaName })}
            onConfirmEmail={() => setState({ status: "confirm_email", invitation: state.invitation })}
            onLoggedIn={() => { devLog("RegisterForm: login 成功 → init() 再実行"); init(); }}
            onError={(msg) => setState({ status: "error", message: msg })}
          />
        )}

        {/* ── ③ confirm: 参加確認（ログイン済みユーザー） ── */}
        {state.status === "confirm" && (
          <JoinConfirm
            token={token}
            invitation={state.invitation}
            userEmail={state.userEmail}
            onJoined={(oaId, oaName) => {
              devLog("Case 3: accept() 成功 → joined");
              setState({ status: "joined", oaId, oaName });
            }}
            onAlreadyJoined={(oaId, oaName) => {
              devLog("Case 7: accept() 409 → already_joined");
              setState({ status: "already_joined", oaId, oaName });
            }}
            onExpired={() => setState({ status: "expired", invitation: state.invitation })}
            onInvalid={() => setState({ status: "invalid" })}
          />
        )}

        {/* ── email_mismatch ── */}
        {state.status === "email_mismatch" && (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#111827", marginBottom: 8, textAlign: "center" }}>
              別のアカウントでログインしています
            </h2>
            <InvitationInfo invitation={state.invitation} userEmail={null} />
            <div style={{
              background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8,
              padding: "12px 14px", marginTop: 16, marginBottom: 20,
              fontSize: 13, color: "#92400e", lineHeight: 1.6,
            }}>
              <strong>この招待は {state.invitation.email} 宛てです。</strong><br />
              現在 <strong>{state.userEmail}</strong> でログイン中のため参加できません。<br />
              招待されたメールアドレスで再ログインしてください。
            </div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: "100%" }}
              onClick={async () => {
                devLog("Case 4: サインアウト → /login");
                const supabase = createSupabaseBrowserClient();
                await supabase.auth.signOut();
                window.location.href = `/login?next=${encodeURIComponent(`/invite/${token}`)}`;
              }}
            >
              別のアカウントでログイン
            </button>
          </>
        )}

        {/* ── confirm_email: メール確認待ち ── */}
        {state.status === "confirm_email" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✉️</div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 12 }}>
              確認メールを送信しました
            </h2>
            <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.8, marginBottom: 20 }}>
              <strong>{state.invitation.email}</strong> 宛に確認メールを送信しました。<br />
              メールのリンクをクリックして登録を完了してください。
            </p>
            <div style={{
              background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8,
              padding: "12px 14px", fontSize: 13, color: "#166534",
              lineHeight: 1.7, textAlign: "left",
            }}>
              確認後はこの招待リンクをもう一度開いて、ワークスペースへの参加を完了してください。
            </div>
          </div>
        )}

        {/* ── registered: 登録完了（初回ユーザー） ── */}
        {state.status === "registered" && (
          <div style={{ textAlign: "center" }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 10 }}>
              アカウント登録が完了しました
            </h2>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24, lineHeight: 1.8 }}>
              ご登録ありがとうございます。ログイン後すぐにご利用いただけます。
            </p>
            <div style={{
              background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8,
              padding: "10px 14px", fontSize: 12, color: "#166534", marginBottom: 24,
            }}>
              まもなくログイン画面へ移動します...
            </div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: "100%" }}
              onClick={() => router.push("/login")}
            >
              ログインして開始する
            </button>
          </div>
        )}

        {/* ── joined: 参加成功（ログイン済みユーザー） ── */}
        {state.status === "joined" && (
          <div style={{ textAlign: "center" }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 8 }}>
              参加しました！
            </h2>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24, lineHeight: 1.7 }}>
              <strong>{state.oaName}</strong> のワークスペースに参加しました。<br />
              まもなくワークスペースへ移動します...
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => router.push(`/oas/${state.oaId}`)}
            >
              今すぐ移動する
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// サブコンポーネント: アカウント登録フォーム（① 未登録ユーザー）
// ────────────────────────────────────────────────────────────────────
function RegisterForm({
  token,
  invitation,
  isRegistered,
  onRegistered,
  onConfirmEmail,
  onLoggedIn,
  onError,
}: {
  token:          string;
  invitation:     InvitationDetail;
  isRegistered:   boolean;
  onRegistered:   (oaName: string) => void;
  onConfirmEmail: () => void;
  onLoggedIn:     () => void;
  onError:        (msg: string) => void;
}) {
  // formMode: 'register' = 新規登録, 'login' = 既存ユーザーログイン
  const [formMode,        setFormMode]        = useState<"register" | "login">(isRegistered ? "login" : "register");
  const [displayName,     setDisplayName]     = useState("");
  const [password,        setPassword]        = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting,      setSubmitting]      = useState(false);
  const [fieldError,      setFieldError]      = useState<string | null>(null);
  const [showPass,        setShowPass]        = useState(false);
  const [showConfirm,     setShowConfirm]     = useState(false);

  // ── ログイン処理 ──
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    if (password.length < 1) { setFieldError("パスワードを入力してください"); return; }

    setSubmitting(true);
    devLog("Case 2: signInWithPassword() 実行", { email: invitation.email });

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: invitation.email,
      password,
    });

    if (error) {
      devLog("Case 2: login エラー", { message: error.message });
      const msg = error.message.includes("Invalid login credentials")
        ? "パスワードが正しくありません"
        : error.message.includes("Email not confirmed")
        ? "メールアドレスの確認が完了していません"
        : translateSupabaseError(error.message);
      setFieldError(msg);
      setSubmitting(false);
      return;
    }

    devLog("Case 2: login 成功 → onLoggedIn()");
    onLoggedIn(); // init() を再実行して confirm 状態へ遷移
  }

  // ── 登録処理 ──
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);

    if (formMode === "login") { return handleLogin(e); }

    if (!displayName.trim()) { setFieldError("ユーザー名を入力してください"); return; }
    if (password.length < 8) { setFieldError("パスワードは8文字以上で入力してください"); return; }
    if (password !== confirmPassword) { setFieldError("パスワードが一致しません"); return; }

    setSubmitting(true);
    devLog("Case 1: signUp() 実行", { email: invitation.email });

    const supabase = createSupabaseBrowserClient();

    const { data, error: signUpError } = await supabase.auth.signUp({
      email:   invitation.email,
      password,
      options: { data: { display_name: displayName.trim() } },
    });

    if (signUpError) {
      devLog("Case 1: signUp() エラー", { message: signUpError.message });
      setFieldError(translateSupabaseError(signUpError.message));
      setSubmitting(false);
      return;
    }

    const session = data.session;

    if (!session) {
      // Supabase メール確認 ON の場合
      devLog("Case 1: session なし → confirm_email（メール確認待ち）");
      onConfirmEmail();
      return;
    }

    devLog("Case 1: session 取得 OK → accept() 実行");

    try {
      await invitationApi.accept(session.access_token, token);
      devLog("Case 1: accept() 成功 → signOut → registered");
      await supabase.auth.signOut();
      onRegistered(invitation.oa_name);
    } catch (err: unknown) {
      await supabase.auth.signOut();
      const anyErr = err as { status?: number; message?: string };
      devLog("Case 1: accept() エラー", { status: anyErr?.status, msg: anyErr?.message });
      onError(anyErr?.message ?? "ワークスペースへの参加処理中にエラーが発生しました");
    }
  }

  return (
    <>
      <h2 style={{ fontSize: 22, fontWeight: 800, color: "#111827", marginBottom: 8, textAlign: "center" }}>
        {formMode === "login" ? "ログインして参加" : "Whale Studioへようこそ"}
      </h2>
      <p style={{ fontSize: 13, color: "#6b7280", textAlign: "center", marginBottom: 28, lineHeight: 1.6 }}>
        {formMode === "login"
          ? "招待されたアカウントでログインしてください"
          : "招待されたアカウントの登録を進めてください"}
      </p>

      {/* ── 招待情報の概要 ── */}
      <InvitationInfo invitation={invitation} userEmail={null} />

      {fieldError && (
        <div className="alert alert-error" style={{ marginBottom: 16, fontSize: 13 }}>
          {fieldError}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ユーザー名（登録モードのみ） */}
        {formMode === "register" && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>ユーザー名</span>
            <input
              type="text"
              className="input"
              placeholder="山田 太郎"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={submitting}
              maxLength={50}
              autoComplete="name"
              autoFocus
              required
            />
          </label>
        )}

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>メールアドレス</span>
          <input
            type="email"
            className="input"
            value={invitation.email}
            readOnly
            style={{ background: "#f9fafb", color: "#6b7280", cursor: "not-allowed" }}
          />
          <span style={{ fontSize: 11, color: "#9ca3af" }}>
            {formMode === "register"
              ? "招待されたメールアドレスで登録されます"
              : "招待されたメールアドレスでログインします"}
          </span>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>パスワード</span>
          <div style={{ position: "relative" }}>
            <input
              type={showPass ? "text" : "password"}
              className="input"
              placeholder={formMode === "register" ? "8文字以上" : "パスワード"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              style={{ paddingRight: 40 }}
              autoComplete={formMode === "register" ? "new-password" : "current-password"}
              autoFocus={formMode === "login"}
              required
            />
            <TogglePassButton show={showPass} onClick={() => setShowPass((p) => !p)} />
          </div>
          {formMode === "register" && password.length > 0 && password.length < 8 && (
            <span style={{ fontSize: 11, color: "#dc2626" }}>8文字以上で入力してください</span>
          )}
        </label>

        {/* パスワード確認（登録モードのみ） */}
        {formMode === "register" && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>パスワード（確認）</span>
            <div style={{ position: "relative" }}>
              <input
                type={showConfirm ? "text" : "password"}
                className="input"
                placeholder="もう一度入力"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={submitting}
                style={{ paddingRight: 40 }}
                autoComplete="new-password"
                required
              />
              <TogglePassButton show={showConfirm} onClick={() => setShowConfirm((p) => !p)} />
            </div>
            {confirmPassword.length > 0 && password !== confirmPassword && (
              <span style={{ fontSize: 11, color: "#dc2626" }}>パスワードが一致しません</span>
            )}
          </label>
        )}

        <button
          type="submit"
          className="btn btn-primary"
          style={{ marginTop: 4 }}
          disabled={submitting}
        >
          {submitting
            ? "処理中..."
            : formMode === "login"
              ? "ログインして参加する"
              : "アカウントを登録して参加する"}
        </button>

      </form>

      {/* ── モード切替 ── */}
      <p style={{ marginTop: 24, textAlign: "center", fontSize: 12, color: "#9ca3af" }}>
        {formMode === "register" ? (
          <>
            すでにアカウントをお持ちの方は{" "}
            <button
              type="button"
              onClick={() => { setFormMode("login"); setFieldError(null); setPassword(""); }}
              style={{ color: "#2F6F5E", fontWeight: 600, textDecoration: "none", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}
            >
              ログインはこちら
            </button>
          </>
        ) : (
          <>
            アカウントをお持ちでない方は{" "}
            <button
              type="button"
              onClick={() => { setFormMode("register"); setFieldError(null); setPassword(""); setConfirmPassword(""); }}
              style={{ color: "#2F6F5E", fontWeight: 600, textDecoration: "none", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}
            >
              新規登録はこちら
            </button>
          </>
        )}
      </p>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// サブコンポーネント: 参加確認（③ ログイン済みユーザー）
// ────────────────────────────────────────────────────────────────────
function JoinConfirm({
  token,
  invitation,
  userEmail,
  onJoined,
  onAlreadyJoined,
  onExpired,
  onInvalid,
}: {
  token:           string;
  invitation:      InvitationDetail;
  userEmail:       string | null;
  onJoined:        (oaId: string, oaName: string) => void;
  onAlreadyJoined: (oaId: string, oaName: string) => void;
  onExpired:       () => void;
  onInvalid:       () => void;
}) {
  const router                    = useRouter();
  const [joining,  setJoining]    = useState(false);
  const [joinErr,  setJoinErr]    = useState<string | null>(null);

  async function handleJoin() {
    setJoining(true);
    setJoinErr(null);
    devLog("Case 3: accept() 呼び出し開始");

    try {
      // セッションから access_token を取得して認証付きで accept を呼ぶ
      const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      let authToken = "dev-token"; // Supabase 未設定時のフォールバック（開発環境のみ）
      if (supabaseUrl && supabaseAnonKey) {
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        authToken = data.session?.access_token ?? "";
        if (!authToken) {
          setJoinErr("セッションが切れています。ページを再読み込みしてください。");
          setJoining(false);
          return;
        }
      }
      await invitationApi.accept(authToken, token);
      onJoined(invitation.oa_id, invitation.oa_name);
    } catch (err: unknown) {
      const anyErr = err as { status?: number; message?: string };
      const msg    = anyErr?.message ?? "";
      devLog("accept() エラー", { status: anyErr?.status, msg });

      if (anyErr?.status === 409) {
        // 冪等性: 既にメンバー → already_joined として扱う
        onAlreadyJoined(invitation.oa_id, invitation.oa_name);
      } else if (anyErr?.status === 410) {
        if (msg.includes("期限")) onExpired(); else onInvalid();
      } else {
        setJoinErr(msg || "参加処理中にエラーが発生しました");
        setJoining(false);
      }
    }
  }

  return (
    <>
      <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 8, textAlign: "center" }}>
        ワークスペースに招待されています
      </h2>
      <p style={{ fontSize: 13, color: "#6b7280", textAlign: "center", marginBottom: 28 }}>
        以下の内容を確認して「参加する」を押してください。
      </p>

      <InvitationInfo invitation={invitation} userEmail={userEmail} />

      {joinErr && (
        <div className="alert alert-error" style={{ marginBottom: 16, fontSize: 13 }}>
          {joinErr}
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary"
        style={{ width: "100%", marginTop: 8 }}
        disabled={joining}
        onClick={handleJoin}
      >
        {joining ? "参加処理中..." : "参加する"}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ width: "100%", marginTop: 8 }}
        onClick={() => router.push("/oas")}
      >
        キャンセル
      </button>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────
// サブコンポーネント: エラーカード（invalid / expired 共通）
// ────────────────────────────────────────────────────────────────────
function ErrorCard({
  icon, title, body, actions,
}: {
  icon:    string;
  title:   string;
  body:    string;
  actions: { label: string; href: string; primary: boolean }[];
}) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: "#111827", marginBottom: 12 }}>
        {title}
      </h2>
      <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.8, marginBottom: 28 }}>
        {body}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {actions.map((a) => (
          <a
            key={a.href}
            href={a.href}
            className={a.primary ? "btn btn-primary" : "btn btn-ghost"}
            style={{ textDecoration: "none", textAlign: "center" }}
          >
            {a.label}
          </a>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// サブコンポーネント: 招待情報テーブル
// ────────────────────────────────────────────────────────────────────
function InvitationInfo({
  invitation, userEmail,
}: {
  invitation: InvitationDetail;
  userEmail:  string | null;
}) {
  const roleLabel  = (ROLE_LABELS as Record<string, string>)[invitation.role] ?? invitation.role;
  const expiresStr = new Date(invitation.expires_at).toLocaleString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div style={{
      background: "#f9fafb", border: "1px solid #e5e7eb",
      borderRadius: 8, overflow: "hidden", marginBottom: 16,
    }}>
      <InfoRow label="ワークスペース" value={invitation.oa_name} />
      <InfoRow
        label="付与されるロール"
        value={
          <span style={{
            display: "inline-block", padding: "2px 10px", borderRadius: 99, fontSize: 12, fontWeight: 700,
            background: ROLE_BADGE_BG[invitation.role]    ?? "#e5e7eb",
            color:      ROLE_BADGE_COLOR[invitation.role] ?? "#374151",
          }}>
            {roleLabel}
          </span>
        }
      />
      <InfoRow label="招待メール" value={invitation.email} />
      <InfoRow label="有効期限"   value={expiresStr} />
      {userEmail !== null && (
        <InfoRow
          label="現在のアカウント"
          value={
            <span style={{ color: userEmail === invitation.email ? "#059669" : "#dc2626" }}>
              {userEmail}
              {userEmail === invitation.email ? " 一致" : " 不一致"}
            </span>
          }
        />
      )}
    </div>
  );
}

const ROLE_BADGE_BG: Record<string, string> = {
  owner: "#fef3c7", admin: "#ede9fe", editor: "#dbeafe", viewer: "#f3f4f6", tester: "#f3f4f6",
};
const ROLE_BADGE_COLOR: Record<string, string> = {
  owner: "#92400e", admin: "#5b21b6", editor: "#1e40af", viewer: "#374151", tester: "#374151",
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", padding: "10px 16px", borderBottom: "1px solid #e5e7eb", fontSize: 13, gap: 12 }}>
      <span style={{ color: "#6b7280", minWidth: 88, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "#111827", fontWeight: 500, wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// サブコンポーネント: パスワード表示トグルボタン
// ────────────────────────────────────────────────────────────────────
function TogglePassButton({ show, onClick }: { show: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      style={{
        position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
        background: "none", border: "none", cursor: "pointer",
        color: "#9ca3af", fontSize: 16, padding: "2px 4px",
      }}
      onClick={onClick}
    >
      {show ? "🙈" : "👁"}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
// Supabase エラーメッセージの日本語変換
// ────────────────────────────────────────────────────────────────────
function translateSupabaseError(msg: string): string {
  if (msg.includes("User already registered"))
    return "このメールアドレスはすでに登録されています。ログイン画面からサインインしてください。";
  if (msg.includes("Password should be at least"))
    return "パスワードは8文字以上で入力してください";
  if (msg.includes("invalid email"))
    return "メールアドレスの形式が正しくありません";
  if (msg.includes("Signup is disabled"))
    return "現在、新規登録を受け付けていません。管理者にお問い合わせください。";
  if (msg.includes("Email rate limit exceeded"))
    return "メール送信の上限に達しました。しばらく待ってから再試行してください。";
  return msg;
}

// ────────────────────────────────────────────────────────────────────
// ページエクスポート
// ────────────────────────────────────────────────────────────────────
export default function InviteTokenPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#9ca3af", fontSize: 14 }}>読み込み中...</p>
      </div>
    }>
      <InvitePage />
    </Suspense>
  );
}
