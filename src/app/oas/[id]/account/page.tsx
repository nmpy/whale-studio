"use client";

// src/app/oas/[id]/account/page.tsx
// GET /api/oas/:id   → フォームプリフィル
// PUT /api/oas/:id   → アカウント情報 + LINE接続情報の更新
// PATCH /api/works/:id → あいさつメッセージ更新

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/Breadcrumb";
import { oaApi, workApi, getDevToken } from "@/lib/api-client";
import { MaskedField } from "@/components/MaskedField";
import { useToast } from "@/components/Toast";
import type { PublishStatus } from "@/types";

interface FormState {
  title:                string;
  description:          string;
  channel_id:           string;
  channel_secret:       string;
  channel_access_token: string;
  publish_status:       PublishStatus;
}

const STATUS_OPTIONS: { value: PublishStatus; label: string; desc: string }[] = [
  { value: "draft",  label: "未設定", desc: "LINE と未接続" },
  { value: "active", label: "稼働中", desc: "Webhook 受信中" },
  { value: "paused", label: "停止中", desc: "一時停止中" },
];

export default function OaAccountPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;
  const router = useRouter();
  const { showToast } = useToast();

  // ── OA フォーム ──
  const [oaTitle, setOaTitle]         = useState("");
  const [form, setForm]               = useState<FormState | null>(null);
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [errors, setErrors]           = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting]   = useState(false);

  // ── あいさつメッセージ ──
  const [primaryWorkId, setPrimaryWorkId]   = useState<string | null>(null);
  const [welcomeMsg, setWelcomeMsg]         = useState<string>("");
  const [welcomeOriginal, setWelcomeOriginal] = useState<string>("");
  const [savingWelcome, setSavingWelcome]   = useState(false);

  useEffect(() => {
    const token = getDevToken();
    Promise.all([
      oaApi.get(token, oaId),
      workApi.list(token, oaId),
    ])
      .then(([oa, works]) => {
        setOaTitle(oa.title);
        setForm({
          title:                oa.title,
          description:          oa.description ?? "",
          channel_id:           oa.channel_id,
          channel_secret:       oa.channel_secret,
          channel_access_token: oa.channel_access_token,
          publish_status:       oa.publish_status,
        });
        // 1OA=1作品想定。先頭の作品をプライマリとして扱う
        const primary = works[0] ?? null;
        if (primary) {
          setPrimaryWorkId(primary.id);
          const wm = primary.welcome_message ?? "";
          setWelcomeMsg(wm);
          setWelcomeOriginal(wm);
        }
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [oaId]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => f ? { ...f, [key]: value } : null);
    setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;

    const errs: Record<string, string[]> = {};
    if (!form.title.trim())                errs.title                = ["アカウント名を入力してください"];
    if (!form.channel_id.trim())           errs.channel_id           = ["Channel ID を入力してください"];
    if (!form.channel_secret.trim())       errs.channel_secret       = ["Channel Secret を入力してください"];
    if (!form.channel_access_token.trim()) errs.channel_access_token = ["Channel Access Token を入力してください"];
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSubmitting(true);
    try {
      await oaApi.update(getDevToken(), oaId, {
        title:                form.title.trim(),
        description:          form.description.trim() || undefined,
        channel_id:           form.channel_id.trim(),
        channel_secret:       form.channel_secret.trim(),
        channel_access_token: form.channel_access_token.trim(),
        publish_status:       form.publish_status,
      });
      showToast("アカウント情報を保存しました", "success");
      router.push(`/oas/${oaId}/settings`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveWelcome() {
    if (!primaryWorkId) return;
    setSavingWelcome(true);
    try {
      await workApi.update(getDevToken(), primaryWorkId, {
        welcome_message: welcomeMsg.trim() || null,
      });
      const saved = welcomeMsg.trim();
      setWelcomeOriginal(saved);
      showToast("あいさつメッセージを保存しました", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSavingWelcome(false);
    }
  }

  // ── ローディング ──────────────────────────────
  const breadcrumbItems = [
    { label: "アカウントリスト", href: "/oas" },
    ...(oaTitle ? [{ label: oaTitle, href: `/oas/${oaId}/works` }] : []),
    { label: "設定", href: `/oas/${oaId}/settings` },
    { label: "アカウント情報" },
  ];

  if (!form && !loadError) {
    return (
      <>
        <div className="page-header">
          <div>
            <Breadcrumb items={breadcrumbItems} />
            <h2>アカウント情報</h2>
          </div>
        </div>
        <div className="card" style={{ maxWidth: 560 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="form-group">
              <div className="skeleton" style={{ width: 100, height: 13, marginBottom: 4 }} />
              <div className="skeleton" style={{ height: 36 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <div className="page-header">
          <div>
            <Breadcrumb items={breadcrumbItems} />
            <h2>アカウント情報</h2>
          </div>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  const welcomeDirty = welcomeMsg !== welcomeOriginal;

  return (
    <>
      <div className="page-header">
        <div>
          <Breadcrumb items={breadcrumbItems} />
          <h2>アカウント情報</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            アカウント名・LINE接続情報・接続ステータスを管理します。
          </p>
        </div>
      </div>

      {/* ── OA 設定フォーム ── */}
      <div className="card" style={{ maxWidth: 560 }}>
        <form onSubmit={handleSubmit}>

          {/* ── アカウント基本情報 ── */}
          <p style={{ fontWeight: 600, marginBottom: 16, color: "#374151" }}>アカウント基本情報</p>

          <div className="form-group">
            <label htmlFor="title">
              アカウント名 <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              id="title"
              type="text"
              value={form!.title}
              onChange={(e) => setField("title", e.target.value)}
              placeholder="例: 謎解きミステリー公式"
              maxLength={100}
            />
            {errors.title?.map((m) => <p key={m} className="field-error">{m}</p>)}
          </div>

          <div className="form-group">
            <label htmlFor="description">メモ（任意）</label>
            <textarea
              id="description"
              value={form!.description}
              onChange={(e) => setField("description", e.target.value)}
              placeholder="このアカウントについてのメモ"
              maxLength={500}
            />
          </div>

          <div className="form-group">
            <label>接続ステータス</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {STATUS_OPTIONS.map(({ value, label, desc }) => (
                <label
                  key={value}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px 12px",
                    border: `2px solid ${form!.publish_status === value ? "#06C755" : "#e5e5e5"}`,
                    borderRadius: 8,
                    cursor: "pointer",
                    background: form!.publish_status === value ? "#E6F7ED" : "#fff",
                  }}
                >
                  <input
                    type="radio"
                    name="publish_status"
                    value={value}
                    checked={form!.publish_status === value}
                    onChange={() => setField("publish_status", value)}
                    style={{ marginTop: 2 }}
                  />
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{label}</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>{desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <hr className="section-divider" />

          {/* ── LINE 接続情報 ── */}
          <p style={{ fontWeight: 600, marginBottom: 4, color: "#374151" }}>LINE 接続情報</p>
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            LINE Developers コンソール → Messaging API タブから取得してください。
            変更しない場合もそのまま保存できます。
          </div>

          <div className="form-group">
            <label htmlFor="channel_id">
              Channel ID <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              id="channel_id"
              type="text"
              value={form!.channel_id}
              onChange={(e) => setField("channel_id", e.target.value)}
              placeholder="例: 1234567890"
              style={{ fontFamily: "monospace" }}
            />
            {errors.channel_id?.map((m) => <p key={m} className="field-error">{m}</p>)}
          </div>

          <MaskedField
            id="channel_secret"
            label="Channel Secret"
            value={form!.channel_secret}
            onChange={(v) => setField("channel_secret", v)}
            required
            errorMessages={errors.channel_secret}
          />

          <MaskedField
            id="channel_access_token"
            label="Channel Access Token"
            value={form!.channel_access_token}
            onChange={(v) => setField("channel_access_token", v)}
            required
            errorMessages={errors.channel_access_token}
          />

          <div className="form-actions">
            <Link href={`/oas/${oaId}/settings`} className="btn btn-ghost">キャンセル</Link>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting && <span className="spinner" />}
              {submitting ? "保存中..." : "保存する"}
            </button>
          </div>

        </form>
      </div>

      {/* ══ あいさつメッセージ ══ */}
      <div
        id="welcome-message"
        className="card"
        style={{ maxWidth: 560, marginTop: 24 }}
      >
        {/* ヘッダー */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: 4,
        }}>
          <span style={{ fontWeight: 600, fontSize: 15, color: "#111827" }}>
            あいさつメッセージ
          </span>
          {welcomeOriginal.trim() ? (
            <span style={{
              fontSize: 11, fontWeight: 600, color: "#16a34a",
              background: "#dcfce7", padding: "1px 7px", borderRadius: 10,
            }}>
              設定済み
            </span>
          ) : (
            <span style={{
              fontSize: 11, color: "#6b7280",
              background: "#f3f4f6", padding: "1px 7px", borderRadius: 10,
            }}>
              未設定
            </span>
          )}
        </div>

        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 14, lineHeight: 1.7 }}>
          友だち追加時や謎解き未開始状態で話しかけたときに送信されるメッセージです。
          このアカウント全体で共通して使われます。
        </p>

        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <strong>💡 書き方のヒント</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.8 }}>
            <li>世界観の説明＋「はじめる」と送ると開始できる旨の案内が効果的です。</li>
            <li>2〜3 文の短いテキストが読みやすいです。</li>
            <li>空白で保存すると「未設定」に戻り、システムのデフォルト文が使われます。</li>
          </ul>
        </div>

        {primaryWorkId ? (
          <>
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label htmlFor="welcome-msg">あいさつ文（最大 1000 文字）</label>
              <textarea
                id="welcome-msg"
                value={welcomeMsg}
                onChange={(e) => setWelcomeMsg(e.target.value)}
                maxLength={1000}
                rows={5}
                placeholder={"例:\nようこそ、謎の館へ。\nあなたを待っていました……\n\n準備ができたら「はじめる」と送ってください。"}
              />
              <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                {welcomeMsg.length} / 1000 文字
              </p>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              {welcomeDirty && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setWelcomeMsg(welcomeOriginal)}
                >
                  変更を元に戻す
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveWelcome}
                disabled={savingWelcome || !welcomeDirty}
              >
                {savingWelcome && <span className="spinner" />}
                {savingWelcome ? "保存中..." : "あいさつメッセージを保存"}
              </button>
            </div>
          </>
        ) : (
          <div style={{
            padding: "16px", background: "#f9fafb", borderRadius: 8,
            fontSize: 13, color: "#6b7280", textAlign: "center",
          }}>
            作品が作成されると、ここであいさつメッセージを設定できます。
          </div>
        )}
      </div>
    </>
  );
}
