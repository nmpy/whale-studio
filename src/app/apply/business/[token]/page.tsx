"use client";

// src/app/apply/business/[token]/page.tsx
// 法人申込フォーム（公開・未認証可）。事前発行された token URL を開いて申し込む。
//
// 設計:
//   - token は URL path から取得し、検証 / 送信は POST body で送る（URL ログ露出を避ける）。
//   - 開いただけでは usedAt を更新しない（validate のみ）。送信時に申請を作成し usedAt をセット。
//   - plan / role / usageType は DB 解決した表示用ラベルを読み取り専用で表示（改ざん防止）。
//   - 申込済 / 期限切れ / 無効化 / 不明トークンは申込不可メッセージを表示。

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

type ViewState = "loading" | "applicable" | "not_applicable" | "submitted" | "error";

interface ValidateData {
  state:            string;
  applicable:       boolean;
  usage_type_label?: string;
  plan_label?:      string;
  role_label?:      string;
  expires_at?:      string | null;
}

const NOT_APPLICABLE_MESSAGE: Record<string, string> = {
  used:    "この申込リンクは既に申込済みです。お心当たりがない場合は発行元にお問い合わせください。",
  expired: "この申込リンクは有効期限が切れています。発行元に新しいリンクの発行をご依頼ください。",
  revoked: "この申込リンクは無効化されています。発行元にお問い合わせください。",
  none:    "この申込リンクは無効です。URL をご確認のうえ、発行元にお問い合わせください。",
};

const wrap: React.CSSProperties = { maxWidth: 560, margin: "0 auto", padding: "8px 0 40px" };
const cardStyle: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff", padding: 20 };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 };
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", fontSize: 14, border: "1.5px solid #e5e7eb",
  borderRadius: 8, background: "#fff", color: "#111827", boxSizing: "border-box",
};

export default function BusinessApplyPage() {
  const params = useParams();
  const token = typeof params.token === "string" ? params.token : Array.isArray(params.token) ? params.token[0] : "";

  const [view, setView] = useState<ViewState>("loading");
  const [info, setInfo] = useState<ValidateData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // フォーム
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [lineOaName, setLineOaName] = useState("");
  const [message, setMessage] = useState("");

  const validate = useCallback(async () => {
    setView("loading");
    try {
      const res = await fetch("/api/business-invite/validate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.data) { setView("error"); return; }
      const data = json.data as ValidateData;
      setInfo(data);
      setView(data.applicable ? "applicable" : "not_applicable");
    } catch {
      setView("error");
    }
  }, [token]);

  useEffect(() => { void validate(); }, [validate]);

  async function handleSubmit() {
    if (submitting) return;
    setFormError(null);
    if (!companyName.trim() || !contactName.trim() || !contactEmail.trim()) {
      setFormError("会社名 / 団体名・お名前・メールアドレスは必須です。");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/business-invite/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          companyName:             companyName.trim(),
          contactName:             contactName.trim(),
          contactEmail:            contactEmail.trim(),
          lineOfficialAccountName: lineOaName.trim() || undefined,
          message:                 message.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 410) {
        // 申込済み / 期限切れ等 → 状態表示に切り替え
        await validate();
        return;
      }
      if (!res.ok) {
        setFormError(json?.error?.message ?? "送信に失敗しました。時間をおいて再度お試しください。");
        return;
      }
      setView("submitted");
    } catch {
      setFormError("送信に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setSubmitting(false);
    }
  }

  // ── 描画 ──
  if (view === "loading") {
    return <div style={wrap}><p style={{ fontSize: 14, color: "#6b7280" }}>読み込み中...</p></div>;
  }

  if (view === "error") {
    return (
      <div style={wrap}>
        <div style={cardStyle}>
          <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>読み込みに失敗しました</h1>
          <p style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.7, marginBottom: 16 }}>
            通信エラーが発生しました。時間をおいて再度お試しください。
          </p>
          <button type="button" onClick={() => void validate()}
            style={{ padding: "9px 18px", fontSize: 13, fontWeight: 700, borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>
            再読み込み
          </button>
        </div>
      </div>
    );
  }

  if (view === "not_applicable") {
    const msg = NOT_APPLICABLE_MESSAGE[info?.state ?? "none"] ?? NOT_APPLICABLE_MESSAGE.none;
    return (
      <div style={wrap}>
        <div style={cardStyle}>
          <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>お申し込みいただけません</h1>
          <p style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.8 }}>{msg}</p>
        </div>
      </div>
    );
  }

  if (view === "submitted") {
    return (
      <div style={wrap}>
        <div style={{ ...cardStyle, border: "2px solid #06C755", background: "#f0fdf4" }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: "#166534" }}>お申し込みを受け付けました</h1>
          <p style={{ fontSize: 14, color: "#374151", lineHeight: 1.8 }}>
            内容を確認のうえ、担当より折り返しご連絡いたします。しばらくお待ちください。
          </p>
        </div>
      </div>
    );
  }

  // applicable
  return (
    <div style={wrap}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>法人お申し込みフォーム</h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16, lineHeight: 1.7 }}>
        以下のプランでのご案内です。内容をご確認のうえ、必要事項をご記入ください。
      </p>

      {/* 読み取り専用の案内内容 */}
      <div style={{ ...cardStyle, marginBottom: 16, background: "#f9fafb" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          <div><span style={{ color: "#6b7280" }}>利用区分：</span><strong>{info?.usage_type_label ?? "—"}</strong></div>
          <div><span style={{ color: "#6b7280" }}>プラン：</span><strong>{info?.plan_label ?? "—"}</strong></div>
          <div><span style={{ color: "#6b7280" }}>権限：</span><strong>{info?.role_label ?? "—"}</strong></div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle} htmlFor="company">会社名 / 団体名 <span style={{ color: "#ef4444" }}>*</span></label>
          <input id="company" style={inputStyle} value={companyName} maxLength={200} onChange={(e) => setCompanyName(e.target.value)} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle} htmlFor="name">お名前 <span style={{ color: "#ef4444" }}>*</span></label>
          <input id="name" style={inputStyle} value={contactName} maxLength={120} onChange={(e) => setContactName(e.target.value)} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle} htmlFor="email">メールアドレス <span style={{ color: "#ef4444" }}>*</span></label>
          <input id="email" type="email" style={inputStyle} value={contactEmail} maxLength={254} onChange={(e) => setContactEmail(e.target.value)} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle} htmlFor="lineoa">LINE公式アカウント名</label>
          <input id="lineoa" style={inputStyle} value={lineOaName} maxLength={200} onChange={(e) => setLineOaName(e.target.value)} placeholder="（任意）" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle} htmlFor="message">相談内容 / 備考</label>
          <textarea id="message" style={{ ...inputStyle, minHeight: 110, resize: "vertical" }} value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} placeholder="（任意）ご要望・ご質問などがあればご記入ください" />
        </div>

        {formError && (
          <p role="alert" style={{ fontSize: 13, color: "#991b1b", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
            {formError}
          </p>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            width: "100%", padding: "12px 18px", fontSize: 14, fontWeight: 700, borderRadius: 8, border: "none",
            background: submitting ? "#9ca3af" : "#06C755", color: "#fff", cursor: submitting ? "default" : "pointer",
          }}
        >
          {submitting ? "送信中..." : "この内容で申し込む"}
        </button>
      </div>
    </div>
  );
}
