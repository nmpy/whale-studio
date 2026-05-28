"use client";

// src/app/onboarding/line-oa/page.tsx
// LINE 公式アカウント連携オンボーディング（Step 1〜3）。
//
// - クエリ ?step=1|2|3 でステップ切り替え
// - Step 1: LINE Official Account Manager への導線（外部リンク）
// - Step 2: Channel 情報入力フォーム
// - Step 3: 権限URLを提出して審査へ

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MaskedField } from "@/components/MaskedField";
import { getDevToken } from "@/lib/api-client";

interface OnboardingOaState {
  id:                 string;
  status:             "DRAFT" | "SUBMITTED" | "IN_REVIEW" | "APPROVED" | "REJECTED";
  oa_name:            string | null;
  channel_id:         string | null;
  channel_secret_set: boolean;
  channel_token_set:  boolean;
  basic_id:           string | null;
  liff_id:            string | null;
  permission_url:     string | null;
  review_note:        string | null;
}

type StepKey = "1" | "2" | "3";

function StepHeader({ step }: { step: StepKey }) {
  const steps: { key: StepKey; label: string }[] = [
    { key: "1", label: "LINE公式アカウントを作成" },
    { key: "2", label: "連携情報を登録" },
    { key: "3", label: "権限URLを提出" },
  ];
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
      {steps.map((s) => {
        const active   = s.key === step;
        const passed   = Number(s.key) < Number(step);
        return (
          <div
            key={s.key}
            style={{
              flex:         "1 1 0",
              minWidth:     140,
              padding:      "10px 12px",
              borderRadius: 8,
              border:       `1px solid ${active ? "#06C755" : passed ? "#a7f3d0" : "#e5e7eb"}`,
              background:   active ? "#ecfdf5" : "#fff",
              fontSize:     12,
            }}
          >
            <div style={{ fontSize: 10, color: active ? "#059669" : passed ? "#10b981" : "#9ca3af", fontWeight: 700 }}>
              STEP {s.key}
            </div>
            <div style={{ marginTop: 2, fontWeight: 600, color: "#111827" }}>{s.label}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function LineOaOnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stepParam = searchParams.get("step");
  const step: StepKey = stepParam === "2" || stepParam === "3" ? stepParam : "1";

  const [state,     setState]     = useState<OnboardingOaState | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  // フォーム入力
  const [oaName,   setOaName]   = useState("");
  const [channelId, setChannelId] = useState("");
  const [channelSecret, setChannelSecret] = useState("");
  const [channelToken,  setChannelToken]  = useState("");
  const [basicId, setBasicId] = useState("");
  const [liffId,  setLiffId]  = useState("");
  const [permissionUrl, setPermissionUrl] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/onboarding/oa", {
          headers: { Authorization: `Bearer ${getDevToken()}` },
        });
        if (!res.ok) throw new Error("オンボーディング情報の取得に失敗しました");
        const json = await res.json();
        const data: OnboardingOaState = json.data;
        setState(data);
        setOaName(data.oa_name ?? "");
        setChannelId(data.channel_id ?? "");
        setBasicId(data.basic_id ?? "");
        setLiffId(data.liff_id ?? "");
        setPermissionUrl(data.permission_url ?? "");
        // 既に提出済みなら審査中画面へ
        if (data.status === "SUBMITTED" || data.status === "IN_REVIEW") {
          router.replace("/onboarding/review");
        }
      } catch (e) {
        setSubmitErr(e instanceof Error ? e.message : "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function handleSaveStep2() {
    if (saving) return;
    setSaving(true);
    setSubmitErr(null);
    try {
      const res = await fetch("/api/onboarding/oa", {
        method:  "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getDevToken()}`,
        },
        body: JSON.stringify({
          oa_name:        oaName        || null,
          channel_id:     channelId     || null,
          channel_secret: channelSecret || null,
          channel_token:  channelToken  || null,
          basic_id:       basicId       || null,
          liff_id:        liffId        || null,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.message || "保存に失敗しました");
      }
      router.push("/onboarding/line-oa?step=3");
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitStep3() {
    if (saving) return;
    setSaving(true);
    setSubmitErr(null);
    try {
      const res = await fetch("/api/onboarding/oa/submit", {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getDevToken()}`,
        },
        body: JSON.stringify({ permission_url: permissionUrl }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.message || "提出に失敗しました");
      }
      router.push("/onboarding/review");
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : "提出に失敗しました");
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 24 }}>読み込み中…</div>;

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>LINE 公式アカウント連携</h1>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
        Whale Studio を利用するために、LINE 公式アカウントの連携情報を順番に登録します。
      </p>

      <StepHeader step={step} />

      {/* 差し戻し時のお知らせ */}
      {state?.status === "REJECTED" && state.review_note && (
        <div
          style={{
            marginBottom: 20,
            padding:      "12px 14px",
            border:       "1px solid #fde68a",
            background:   "#fffbeb",
            borderRadius: 8,
            fontSize:     13,
            color:        "#92400e",
          }}
        >
          <strong>運営より差し戻しがあります：</strong>
          <div style={{ marginTop: 4 }}>{state.review_note}</div>
        </div>
      )}

      {submitErr && (
        <div
          style={{
            marginBottom: 16,
            padding:      "10px 14px",
            border:       "1px solid #fecaca",
            background:   "#fef2f2",
            color:        "#dc2626",
            borderRadius: 6,
            fontSize:     13,
          }}
        >
          {submitErr}
        </div>
      )}

      {/* ─────────── Step 1 ─────────── */}
      {step === "1" && (
        <section>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>LINE公式アカウントを作成</h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#374151" }}>
            まずは、利用する LINE 公式アカウントを作成してください。<br />
            作成済みの場合は、そのまま次のステップへ進めます。
          </p>
          <div style={{ marginTop: 16 }}>
            <a
              href="https://manager.line.biz/"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
              style={{ padding: "8px 16px", display: "inline-block" }}
            >
              LINE Official Account Manager を開く ↗
            </a>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
            <button
              type="button"
              onClick={() => router.push("/onboarding/line-oa?step=2")}
              className="btn btn-primary"
              style={{ padding: "8px 20px" }}
            >
              作成完了 → 次へ
            </button>
          </div>
        </section>
      )}

      {/* ─────────── Step 2 ─────────── */}
      {step === "2" && (
        <section>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>LINE Developers で連携情報を確認</h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#374151" }}>
            LINE Developers の Provider / Channel から、Whale Studio に登録する各値を確認してください。
          </p>
          <div style={{ marginTop: 12, marginBottom: 16 }}>
            <a
              href="https://developers.line.biz/console/"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
              style={{ padding: "8px 16px", display: "inline-block" }}
            >
              LINE Developers を開く ↗
            </a>
          </div>

          <div className="form-group">
            <label htmlFor="oa_name">LINE公式アカウント名 <span style={{ color: "#ef4444" }}>*</span></label>
            <input
              id="oa_name"
              type="text"
              className="form-input"
              value={oaName}
              onChange={(e) => setOaName(e.target.value)}
              placeholder="例: 謎解きAccount"
            />
          </div>

          <div className="form-group">
            <label htmlFor="channel_id">Channel ID <span style={{ color: "#ef4444" }}>*</span></label>
            <input
              id="channel_id"
              type="text"
              className="form-input"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              placeholder="例: 1234567890"
            />
          </div>

          <MaskedField
            id="channel_secret"
            label="Channel Secret"
            value={channelSecret}
            onChange={setChannelSecret}
            placeholder={state?.channel_secret_set ? "（保存済み・新しい値を入力すると上書き）" : "Channel Secret を貼り付け"}
            required
          />

          <MaskedField
            id="channel_token"
            label="Channel Access Token"
            value={channelToken}
            onChange={setChannelToken}
            placeholder={state?.channel_token_set ? "（保存済み・新しい値を入力すると上書き）" : "Channel Access Token を貼り付け"}
            required
          />

          <div className="form-group">
            <label htmlFor="basic_id">Basic ID（任意）</label>
            <input
              id="basic_id"
              type="text"
              className="form-input"
              value={basicId}
              onChange={(e) => setBasicId(e.target.value)}
              placeholder="例: 613zlngs"
            />
          </div>

          <div className="form-group">
            <label htmlFor="liff_id">LIFF ID（任意）</label>
            <input
              id="liff_id"
              type="text"
              className="form-input"
              value={liffId}
              onChange={(e) => setLiffId(e.target.value)}
              placeholder="LIFF を使う場合のみ入力"
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
            <button
              type="button"
              onClick={() => router.push("/onboarding/line-oa?step=1")}
              className="btn btn-ghost"
              style={{ padding: "8px 16px" }}
            >
              ← 戻る
            </button>
            <button
              type="button"
              onClick={handleSaveStep2}
              disabled={saving}
              className="btn btn-primary"
              style={{ padding: "8px 20px" }}
            >
              {saving ? "保存中…" : "保存して次へ →"}
            </button>
          </div>
        </section>
      )}

      {/* ─────────── Step 3 ─────────── */}
      {step === "3" && (
        <section>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>権限URLを貼り付け</h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#374151" }}>
            Whale Studio 運営側で連携内容を確認するため、権限URLを貼り付けて審査に提出してください。<br />
            提出後は審査中ステータスとなります。
          </p>

          <div className="form-group" style={{ marginTop: 16 }}>
            <label htmlFor="permission_url">権限URL <span style={{ color: "#ef4444" }}>*</span></label>
            <input
              id="permission_url"
              type="url"
              className="form-input"
              value={permissionUrl}
              onChange={(e) => setPermissionUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
            <button
              type="button"
              onClick={() => router.push("/onboarding/line-oa?step=2")}
              className="btn btn-ghost"
              style={{ padding: "8px 16px" }}
            >
              ← 戻る
            </button>
            <button
              type="button"
              onClick={handleSubmitStep3}
              disabled={saving || !permissionUrl}
              className="btn btn-primary"
              style={{ padding: "8px 20px" }}
            >
              {saving ? "送信中…" : "審査に提出する"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
