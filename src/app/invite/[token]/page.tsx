"use client";
// src/app/invite/[token]/page.tsx
//
// 招待受け入れページ
//
// 画面状態:
//   loading        — トークン検証中
//   valid          — 有効な招待（参加ボタン表示）
//   email_mismatch — 別メールでログイン中
//   expired        — 招待期限切れ
//   accepted       — 既に受け入れ済み
//   invalid        — 無効なトークン
//   not_member     — 承諾処理後エラー（OA 不一致等）
//
// 遷移フロー:
//   未ログイン            → /login?next=/invite/[token] (middleware が自動リダイレクト)
//   valid + 参加ボタン押下 → POST accept → /oas/[oa_id]
//   期限切れ / 受け入れ済み → エラー表示 + 「OA一覧へ」リンク

import { Suspense, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { invitationApi, type InvitationDetail } from "@/lib/api-client";
import { ROLE_LABELS } from "@/lib/types/permissions";
import { INVITATION_STATE_LABELS, STATUS_LABELS } from "@/lib/constants/member-text";

// ── 招待の状態型 ──────────────────────────────────────────────────────
type InviteState =
  | { status: "loading" }
  | { status: "valid";          invitation: InvitationDetail; userEmail: string | null }
  | { status: "email_mismatch"; invitation: InvitationDetail; userEmail: string }
  | { status: "expired";        invitation?: InvitationDetail }
  | { status: "accepted";       invitation?: InvitationDetail }
  | { status: "invalid";        message: string }
  | { status: "joined";         oaId: string; oaName: string };

// ── エラーコード → state マッピング ──────────────────────────────────
function apiErrorToState(
  code: string,
  message: string,
  invitation?: InvitationDetail
): InviteState {
  if (code === "INVITATION_EXPIRED")          return { status: "expired",  invitation };
  if (code === "INVITATION_ALREADY_ACCEPTED") return { status: "accepted", invitation };
  return { status: "invalid", message };
}

// ────────────────────────────────────────────────────────────────────
// メインコンポーネント
// ────────────────────────────────────────────────────────────────────
function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const token  = typeof params.token === "string" ? params.token : Array.isArray(params.token) ? params.token[0] : "";

  const [state,    setState]    = useState<InviteState>({ status: "loading" });
  const [joining,  setJoining]  = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // ── 初期化: セッション取得 + トークン検証 ──────────────────────
  useEffect(() => {
    if (!token) {
      setState({ status: "invalid", message: "招待トークンが見つかりません" });
      return;
    }

    async function init() {
      // 1. ログイン状態を確認
      const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      let userEmail: string | null = null;

      if (supabaseUrl && supabaseAnonKey) {
        const supabase  = createSupabaseBrowserClient();
        const { data }  = await supabase.auth.getSession();
        const session   = data.session;

        if (!session) {
          // 未ログイン → ログインページへ
          const next = encodeURIComponent(`/invite/${token}`);
          window.location.href = `/login?next=${next}`;
          return;
        }
        userEmail = session.user.email ?? null;
      }
      // Supabase 未設定（dev 環境）はメール照合をスキップして続行

      // 2. 招待トークンを検証
      try {
        const invitation = await invitationApi.validate(token);

        // メールアドレス照合（Supabase 設定済み + メール取得できた場合のみ）
        if (userEmail && invitation.email !== userEmail) {
          setState({ status: "email_mismatch", invitation, userEmail });
          return;
        }

        setState({ status: "valid", invitation, userEmail });
      } catch (err: unknown) {
        // invitationApi.validate は 410 を throw する（parseResponse 経由）
        // ただし 410 は専用クラスがないので Error として来る
        const anyErr = err as { status?: number; message?: string };
        const msg    = anyErr?.message ?? "招待の確認中にエラーが発生しました";

        if (anyErr?.status === 410) {
          // 410 は期限切れ or 受け入れ済み — メッセージで分岐
          if (msg.includes("期限")) {
            setState({ status: "expired" });
          } else {
            setState({ status: "accepted" });
          }
        } else if (anyErr?.status === 404) {
          setState({ status: "invalid", message: "招待リンクが無効です" });
        } else {
          setState({ status: "invalid", message: msg });
        }
      }
    }

    init();
  }, [token]);

  // ── 「参加する」押下ハンドラ ─────────────────────────────────────
  async function handleJoin() {
    if (state.status !== "valid") return;

    setJoining(true);
    setJoinError(null);

    try {
      // auth token: Supabase cookie ベース認証なので Bearer は空でも動く（サーバー側が cookie を読む）
      // ただし getDevToken() を渡す形式を維持して Authorization ヘッダーを付与する
      const authToken  = "dev-token"; // サーバー side は cookie を優先するため値は問わない
      const result     = await invitationApi.accept(authToken, token);

      setState({ status: "joined", oaId: result.oa_id, oaName: state.invitation.oa_name });
    } catch (err: unknown) {
      const anyErr = err as { status?: number; message?: string };
      const msg    = anyErr?.message ?? "参加処理中にエラーが発生しました";

      if (anyErr?.status === 410) {
        if (msg.includes("期限")) {
          setState({ status: "expired", invitation: state.invitation });
        } else {
          setState({ status: "accepted", invitation: state.invitation });
        }
      } else if (anyErr?.status === 409) {
        // 既にメンバー → そのまま OA に遷移
        router.push(`/oas/${state.invitation.oa_id}`);
      } else {
        setJoinError(msg);
        setJoining(false);
      }
    }
  }

  // ── 参加成功後の自動リダイレクト ──────────────────────────────────
  useEffect(() => {
    if (state.status === "joined") {
      const timer = setTimeout(() => {
        router.push(`/oas/${state.oaId}`);
      }, 2000);
      return () => clearTimeout(timer);
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

        {/* ── 有効な招待 ── */}
        {state.status === "valid" && (
          <>
            <div style={{ fontSize: 36, marginBottom: 16, textAlign: "center" }}>🎉</div>
            <h2 style={{
              fontSize:     20,
              fontWeight:   800,
              color:        "#111827",
              marginBottom: 8,
              textAlign:    "center",
            }}>
              ワークスペースに招待されています
            </h2>
            <p style={{ fontSize: 13, color: "#6b7280", textAlign: "center", marginBottom: 28 }}>
              以下の内容を確認して「参加する」を押してください。
            </p>

            <InvitationInfo
              invitation={state.invitation}
              userEmail={state.userEmail}
            />

            {joinError && (
              <div className="alert alert-error" style={{ marginBottom: 16, fontSize: 13 }}>
                {joinError}
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
        )}

        {/* ── メール不一致 ── */}
        {state.status === "email_mismatch" && (
          <>
            <div style={{ fontSize: 36, marginBottom: 16, textAlign: "center" }}>⚠️</div>
            <h2 style={{
              fontSize:     18,
              fontWeight:   800,
              color:        "#111827",
              marginBottom: 8,
              textAlign:    "center",
            }}>
              別のアカウントでログインしています
            </h2>

            <InvitationInfo invitation={state.invitation} userEmail={null} />

            <div style={{
              background:   "#fef3c7",
              border:       "1px solid #fcd34d",
              borderRadius: 8,
              padding:      "12px 14px",
              marginTop:    16,
              marginBottom: 20,
              fontSize:     13,
              color:        "#92400e",
              lineHeight:   1.6,
            }}>
              <strong>この招待は {state.invitation.email} 宛てです。</strong>
              <br />
              現在 <strong>{state.userEmail}</strong> でログイン中のため参加できません。
              <br />
              招待されたメールアドレスで再ログインしてください。
            </div>

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: "100%" }}
              onClick={async () => {
                const supabase = createSupabaseBrowserClient();
                await supabase.auth.signOut();
                const next = encodeURIComponent(`/invite/${token}`);
                window.location.href = `/login?next=${next}`;
              }}
            >
              別のアカウントでログイン
            </button>
          </>
        )}

        {/* ── 参加成功 ── */}
        {state.status === "joined" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h2 style={{
              fontSize:     20,
              fontWeight:   800,
              color:        "#111827",
              marginBottom: 8,
            }}>
              参加しました！
            </h2>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24, lineHeight: 1.7 }}>
              <strong>{state.oaName}</strong> のワークスペースに参加しました。
              <br />
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

        {/* ── 期限切れ ── */}
        {state.status === "expired" && (
          <ErrorState
            icon="⏰"
            title="招待リンクの有効期限が切れています"
            body="このリンクの有効期限が過ぎています。ワークスペースのオーナーまたは管理者に再招待を依頼してください。"
            errorCode="INVITATION_EXPIRED"
          />
        )}

        {/* ── 承諾済み ── */}
        {state.status === "accepted" && (
          <ErrorState
            icon="✅"
            title="この招待はすでに承諾されています"
            body="この招待リンクはすでに使用済みです。ワークスペースにアクセスするにはログインしてください。"
            errorCode="INVITATION_ALREADY_ACCEPTED"
            action={
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: 16 }}
                onClick={() => router.push("/oas")}
              >
                OA 一覧へ
              </button>
            }
          />
        )}

        {/* ── 無効なトークン ── */}
        {state.status === "invalid" && (
          <ErrorState
            icon="🔗"
            title="無効な招待リンクです"
            body={state.message}
            errorCode="INVITATION_INVALID"
          />
        )}

      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// サブコンポーネント: 招待情報テーブル
// ────────────────────────────────────────────────────────────────────
function InvitationInfo({
  invitation,
  userEmail,
}: {
  invitation: InvitationDetail;
  userEmail:  string | null;
}) {
  const roleLabel = (ROLE_LABELS as Record<string, string>)[invitation.role] ?? invitation.role;
  const expiresAt = new Date(invitation.expires_at);
  const expiresStr = expiresAt.toLocaleString("ja-JP", {
    year:   "numeric",
    month:  "2-digit",
    day:    "2-digit",
    hour:   "2-digit",
    minute: "2-digit",
  });

  return (
    <div style={{
      background:   "#f9fafb",
      border:       "1px solid #e5e7eb",
      borderRadius: 8,
      overflow:     "hidden",
      marginBottom: 16,
    }}>
      <InfoRow label="ワークスペース" value={invitation.oa_name} />
      <InfoRow label="付与されるロール" value={
        <span style={{
          display:      "inline-block",
          padding:      "2px 10px",
          borderRadius: 99,
          fontSize:     12,
          fontWeight:   700,
          background:   ROLE_BADGE_BG[invitation.role] ?? "#e5e7eb",
          color:        ROLE_BADGE_COLOR[invitation.role] ?? "#374151",
        }}>
          {roleLabel}
        </span>
      } />
      <InfoRow label="招待メール"     value={invitation.email} />
      <InfoRow label="有効期限"       value={expiresStr} />
      {userEmail !== null && (
        <InfoRow
          label="現在のアカウント"
          value={
            <span style={{ color: userEmail === invitation.email ? "#059669" : "#dc2626" }}>
              {userEmail}
              {userEmail === invitation.email
                ? " ✓ 一致"
                : " ⚠ 不一致"}
            </span>
          }
        />
      )}
    </div>
  );
}

const ROLE_BADGE_BG: Record<string, string> = {
  owner:  "#fef3c7",
  admin:  "#ede9fe",
  editor: "#dbeafe",
  tester: "#f3f4f6",
};
const ROLE_BADGE_COLOR: Record<string, string> = {
  owner:  "#92400e",
  admin:  "#5b21b6",
  editor: "#1e40af",
  tester: "#374151",
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{
      display:       "flex",
      padding:       "10px 16px",
      borderBottom:  "1px solid #e5e7eb",
      fontSize:      13,
      gap:           12,
    }}
    className="_info-row"
    >
      <span style={{ color: "#6b7280", minWidth: 88, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "#111827", fontWeight: 500, wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// サブコンポーネント: エラー状態
// ────────────────────────────────────────────────────────────────────
function ErrorState({
  icon,
  title,
  body,
  errorCode,
  action,
}: {
  icon:      string;
  title:     string;
  body:      string;
  errorCode: string;
  action?:   React.ReactNode;
}) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
      <h2 style={{
        fontSize:     18,
        fontWeight:   800,
        color:        "#111827",
        marginBottom: 10,
      }}>
        {title}
      </h2>
      <p style={{
        fontSize:     14,
        color:        "#6b7280",
        lineHeight:   1.7,
        marginBottom: 20,
      }}>
        {body}
      </p>

      <div style={{
        background:   "#f9fafb",
        border:       "1px solid #e5e7eb",
        borderRadius: 6,
        padding:      "6px 12px",
        fontSize:     11,
        color:        "#9ca3af",
        fontFamily:   "monospace",
        marginBottom: 8,
      }}>
        error: {errorCode}
      </div>

      {action ?? (
        <a
          href="/oas"
          style={{
            display:        "inline-block",
            marginTop:      16,
            fontSize:       13,
            color:          "#6b7280",
            textDecoration: "underline",
          }}
        >
          OA 一覧に戻る
        </a>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// ページエクスポート（useSearchParams を含む Suspense ラップ）
// ────────────────────────────────────────────────────────────────────
export default function InviteTokenPage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight:      "100vh",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
      }}>
        <p style={{ color: "#9ca3af", fontSize: 14 }}>読み込み中...</p>
      </div>
    }>
      <InvitePage />
    </Suspense>
  );
}
