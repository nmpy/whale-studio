"use client";

// src/app/studio-invites/[token]/page.tsx
// 招待URL受諾の着地ページ（公開）。状態に応じて受諾フォーム / 期限切れ / 使用済み / 不明を表示する。
//
// - 期限切れ: 専用文言を表示（権限取得不可）。副作用は起こさない。
// - 受諾は認証必須。未ログインなら /login?next=... へ誘導し、ログイン後に戻って受諾できる。

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { getAuthHeaders } from "@/lib/api-client";
import { studioInviteLandingShowsAcceptForm } from "@/lib/studio-invite-ui";

type ValidateResp = {
  state: "active" | "accepted" | "used_up" | "expired" | "revoked" | "none" | "suspended";
  valid: boolean;
  oa_name?: string;
  usage_type_label?: string;
  plan_label?: string;
  role_label?: string;
  expires_at?: string;
};

const EXPIRED_TITLE = "登録までに一定期間を過ぎたため、権限を取得することができません。";
const EXPIRED_BODY  = "お手数ですが、招待URLの発行者に新しい招待URLの発行を依頼してください。";

function fmt(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function StudioInviteLandingPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = String(params?.token ?? "");

  const [info, setInfo]       = useState<ValidateResp | null>(null);
  const [view, setView]       = useState<"loading" | "ready" | "error" | "joined">("loading");
  const [errorMsg, setError]  = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  const validate = useCallback(async () => {
    setView("loading");
    setError(null);
    try {
      const res = await fetch(`/api/studio-invites/${token}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      setInfo((json.data ?? json) as ValidateResp);
      setView("ready");
    } catch {
      setView("error");
      setError("通信エラーが発生しました。");
    }
  }, [token]);

  useEffect(() => { if (token) validate(); }, [token, validate]);

  async function accept() {
    if (accepting) return;
    setAccepting(true);
    setError(null);
    try {
      const res = await fetch(`/api/studio-invites/${token}/accept`, {
        method:  "POST",
        headers: { ...getAuthHeaders() },
      });
      if (res.status === 401) {
        // 未ログイン → ログイン後にこのページへ戻る。
        router.push(`/login?next=/studio-invites/${token}`);
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 期限切れ/使用済み等になっていた場合は状態を取り直して表示を更新する。
        setError(json?.error?.message ?? "受諾に失敗しました。");
        await validate();
        return;
      }
      const d = json.data ?? json;
      setView("joined");
      setTimeout(() => { router.push(d?.oa_id ? `/oas/${d.oa_id}/works` : "/oas"); }, 1200);
    } catch {
      setError("通信エラーが発生しました。");
    } finally {
      setAccepting(false);
    }
  }

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#f6f8f7" }}>
      <div style={{ width: "100%", maxWidth: 440, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: "28px 24px", boxShadow: "0 2px 12px rgba(31,64,92,0.06)" }}>
        {children}
      </div>
    </div>
  );

  if (view === "loading") {
    return shell(<p style={{ fontSize: 13, color: "#6b7280", textAlign: "center", padding: "20px 0" }}>読み込んでいます…</p>);
  }

  if (view === "joined") {
    return shell(
      <>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#166534" }}>権限を受け取りました</h1>
        <p style={{ fontSize: 13, color: "#166534", marginTop: 10, lineHeight: 1.7 }}>移動しています…</p>
      </>,
    );
  }

  // ready / error states share the card; branch on validated state.
  const state = info?.state ?? "none";

  if (state === "expired") {
    return shell(
      <>
        <div style={{ fontSize: 40, marginBottom: 12, textAlign: "center" }}>⏳</div>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: "#92400e", lineHeight: 1.6 }}>{EXPIRED_TITLE}</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 12, lineHeight: 1.8 }}>{EXPIRED_BODY}</p>
      </>,
    );
  }

  if (state === "accepted") {
    return shell(
      <>
        <div style={{ fontSize: 40, marginBottom: 12, textAlign: "center" }}>✅</div>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: "#374151" }}>この招待URLはすでに使用されています。</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 12, lineHeight: 1.8 }}>
          別の招待URLが必要な場合は、発行者にお問い合わせください。
        </p>
      </>,
    );
  }

  if (state === "used_up") {
    return shell(
      <>
        <div style={{ fontSize: 40, marginBottom: 12, textAlign: "center" }}>✅</div>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: "#374151" }}>この招待は使用済みです</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 12, lineHeight: 1.8 }}>
          この招待URLは使用上限に達しているため、現在は利用できません。必要な場合は、管理者に新しい招待URLの発行を依頼してください。
        </p>
      </>,
    );
  }

  // active 以外（none / revoked / suspended / 未知状態）はフォームを出さず「見つかりません」を表示。
  if (!studioInviteLandingShowsAcceptForm(state)) {
    return shell(
      <>
        <div style={{ fontSize: 40, marginBottom: 12, textAlign: "center" }}>🔍</div>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: "#374151" }}>招待URLが見つかりません。</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 12, lineHeight: 1.8 }}>
          URL が正しいかご確認のうえ、発行者にお問い合わせください。
        </p>
      </>,
    );
  }

  // active
  return shell(
    <>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 4 }}>招待を受け取る</h1>
      <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.7 }}>
        以下の内容で権限が付与されます。
      </p>
      <div style={{ marginTop: 16, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 16px", fontSize: 13, lineHeight: 2 }}>
        <div><span style={{ color: "#6b7280" }}>アカウント：</span><b>{info?.oa_name}</b></div>
        <div><span style={{ color: "#6b7280" }}>利用区分：</span>{info?.usage_type_label}</div>
        <div><span style={{ color: "#6b7280" }}>プラン：</span>{info?.plan_label}</div>
        <div><span style={{ color: "#6b7280" }}>権限：</span>{info?.role_label}</div>
        <div><span style={{ color: "#6b7280" }}>有効期限：</span>{fmt(info?.expires_at)}</div>
      </div>

      {errorMsg && (
        <p style={{ fontSize: 13, color: "#b91c1c", marginTop: 14, lineHeight: 1.7 }}>{errorMsg}</p>
      )}

      <button
        type="button"
        onClick={accept}
        disabled={accepting}
        style={{
          marginTop: 18, width: "100%", padding: "11px 0", fontSize: 14, fontWeight: 700,
          color: "#fff", background: "var(--color-primary, #2F6F5E)", border: "none", borderRadius: 12,
          cursor: accepting ? "default" : "pointer", opacity: accepting ? 0.7 : 1,
        }}
      >
        {accepting ? "受け取っています…" : "この招待を受け取る"}
      </button>
      <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 10, textAlign: "center", lineHeight: 1.7 }}>
        ※ 受け取りにはログインが必要です。未ログインの場合はログイン後にこの画面へ戻ります。
      </p>
    </>,
  );
}
