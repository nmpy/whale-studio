"use client";

// src/app/invites/member/[token]/page.tsx
// メールアドレス不要の「招待URL」受け取りページ。
// - 招待を検証して OA 名・付与ロールを表示
// - 未ログイン: /login?next=<このURL> へ誘導（ログイン/新規登録後にここへ戻り承諾）
// - ログイン済み: 「このアカウントで参加する」で承諾 → 対象 OA の作品一覧へ

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { memberInviteApi, type MemberInviteValidateResult } from "@/lib/api-client";

const ROLE_LABEL: Record<string, string> = {
  admin: "管理者", editor: "編集者", tester: "テスター", viewer: "閲覧者",
};

type View = "loading" | "invalid" | "ready" | "joining" | "joined" | "error";

const STATUS_MESSAGE: Record<string, string> = {
  invalid:   "この招待URLは無効です。発行者に新しい招待URLの発行を依頼してください。",
  expired:   "この招待URLは有効期限が切れています。発行者に再発行を依頼してください。",
  revoked:   "この招待URLは無効化されています。発行者に再発行を依頼してください。",
  accepted:  "この招待URLは既に使用されています。発行者に新しい招待URLの発行を依頼してください。",
  suspended: "このアカウントは現在ご利用いただけません。",
};

export default function MemberInvitePage() {
  const params = useParams();
  const token = params.token as string;

  const [view, setView]       = useState<View>("loading");
  const [info, setInfo]       = useState<MemberInviteValidateResult | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selfUrl = `/invites/member/${token}`;

  const init = useCallback(async () => {
    setView("loading");
    setErrorMsg(null);
    try {
      const res = await memberInviteApi.validate(token);
      setInfo(res);
      if (!res.valid) { setView("invalid"); return; }
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      setLoggedIn(!!data.session);
      setView("ready");
    } catch {
      setErrorMsg("招待URLの確認に失敗しました。通信環境を確認してもう一度お試しください。");
      setView("error");
    }
  }, [token]);

  useEffect(() => { void init(); }, [init]);

  async function handleJoin() {
    setView("joining");
    setErrorMsg(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token ?? "";
      if (!accessToken) {
        // セッション切れ → ログインへ誘導
        window.location.href = `/login?next=${encodeURIComponent(selfUrl)}`;
        return;
      }
      const result = await memberInviteApi.accept(accessToken, token);
      setView("joined");
      // 対象 OA の作品一覧へ
      setTimeout(() => { window.location.href = `/oas/${result.oa_id}/works`; }, 1200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "参加に失敗しました";
      setErrorMsg(msg);
      setView("error");
    }
  }

  function goLogin() {
    window.location.href = `/login?next=${encodeURIComponent(selfUrl)}`;
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#f6f8f7" }}>
      <div style={{ width: "100%", maxWidth: 420, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: "28px 24px", boxShadow: "0 2px 12px rgba(31,64,92,0.06)" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: "#111827" }}>メンバー招待</h1>

        {view === "loading" && (
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 12 }}>招待URLを確認しています…</p>
        )}

        {(view === "invalid") && (
          <p style={{ fontSize: 13, color: "#b91c1c", marginTop: 12, lineHeight: 1.7 }}>
            {STATUS_MESSAGE[info?.status ?? "invalid"] ?? STATUS_MESSAGE.invalid}
          </p>
        )}

        {(view === "ready" || view === "joining") && info?.valid && (
          <>
            <p style={{ fontSize: 13, color: "#374151", marginTop: 12, lineHeight: 1.8 }}>
              <strong style={{ color: "#111827" }}>{info.oa_name}</strong> に
              <strong style={{ color: "#111827" }}>「{ROLE_LABEL[info.role ?? ""] ?? info.role}」</strong>として招待されています。
            </p>
            {loggedIn ? (
              <>
                <button
                  type="button"
                  onClick={handleJoin}
                  disabled={view === "joining"}
                  style={{ marginTop: 20, width: "100%", padding: "11px 0", background: "#2563eb", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: view === "joining" ? "not-allowed" : "pointer", opacity: view === "joining" ? 0.6 : 1 }}
                >
                  {view === "joining" ? "参加処理中…" : "このアカウントで参加する"}
                </button>
                <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 10, lineHeight: 1.6 }}>
                  ログイン中のアカウントでこのアカウント（OA）に参加します。
                </p>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={goLogin}
                  style={{ marginTop: 20, width: "100%", padding: "11px 0", background: "#2563eb", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
                >
                  ログインまたは新規登録して参加
                </button>
                <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 10, lineHeight: 1.6 }}>
                  はじめての方は新規登録（メールアドレスの登録）後にこのページへ戻り、参加できます。
                  <br />
                  メール確認が必要な場合は、確認後にこの招待URLをもう一度開いてください。
                </p>
              </>
            )}
          </>
        )}

        {view === "joined" && (
          <p style={{ fontSize: 13, color: "#166534", marginTop: 12, lineHeight: 1.7 }}>
            参加しました。移動しています…
          </p>
        )}

        {view === "error" && (
          <>
            <p style={{ fontSize: 13, color: "#b91c1c", marginTop: 12, lineHeight: 1.7 }}>{errorMsg ?? "エラーが発生しました"}</p>
            <button type="button" onClick={() => void init()} style={{ marginTop: 14, fontSize: 12, color: "#2563eb", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
              もう一度試す
            </button>
          </>
        )}
      </div>
    </div>
  );
}
