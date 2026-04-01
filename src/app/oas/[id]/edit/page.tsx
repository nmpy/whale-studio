"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { oaApi, getDevToken } from "@/lib/api-client";
import { MaskedField } from "@/components/MaskedField";
import { useToast } from "@/components/Toast";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { PublishStatus } from "@/types";

interface FormState {
  title: string;
  description: string;
  line_oa_id: string;
  channel_id: string;
  channel_secret: string;
  channel_access_token: string;
  publish_status: PublishStatus;
  spreadsheet_id: string;
}

const STATUS_OPTIONS: { value: PublishStatus; label: string }[] = [
  { value: "draft",  label: "下書き（非公開）" },
  { value: "active", label: "公開中" },
  { value: "paused", label: "停止中" },
];

export default function OaEditPage() {
  const params    = useParams<{ id: string }>();
  const oaId      = params.id;
  const router    = useRouter();
  const { showToast } = useToast();

  const [form, setForm]           = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors]       = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  // 初期データ読み込み
  useEffect(() => {
    const token = getDevToken();
    oaApi.get(token, oaId)
      .then((oa) => {
        setForm({
          title:                oa.title,
          description:          oa.description ?? "",
          line_oa_id:           oa.line_oa_id ?? "",
          channel_id:           oa.channel_id,
          channel_secret:       oa.channel_secret,
          channel_access_token: oa.channel_access_token,
          publish_status:       oa.publish_status,
          spreadsheet_id:       oa.spreadsheet_id ?? "",
        });
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [oaId]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => f ? { ...f, [key]: value } : null);
    setErrors((e) => { const next = { ...e }; delete next[key]; return next; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSubmitting(true);
    setErrors({});

    // クライアントバリデーション
    const clientErrors: Record<string, string[]> = {};
    if (!form.title.trim())                 clientErrors.title = ["作品名を入力してください"];
    if (!form.channel_id.trim())             clientErrors.channel_id = ["Channel IDを入力してください"];
    if (!form.channel_secret.trim())         clientErrors.channel_secret = ["Channel Secretを入力してください"];
    if (!form.channel_access_token.trim())   clientErrors.channel_access_token = ["Channel Access Tokenを入力してください"];
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      setSubmitting(false);
      return;
    }

    try {
      await oaApi.update(getDevToken(), oaId, {
        title:                form.title.trim(),
        description:          form.description.trim() || undefined,
        line_oa_id:           form.line_oa_id.trim() || null,
        channel_id:           form.channel_id.trim(),
        channel_secret:       form.channel_secret.trim(),
        channel_access_token: form.channel_access_token.trim(),
        publish_status:       form.publish_status,
        spreadsheet_id:       form.spreadsheet_id.trim() || null,
      });
      showToast("OA情報を保存しました", "success");
      router.push("/oas");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
    } finally {
      setSubmitting(false);
    }
  }

  // ── ローディング ──────────────────────────────
  if (!form && !loadError) {
    return (
      <>
        <div className="page-header">
          <div>
            <Breadcrumb items={[{ label: "アカウントリスト", href: "/oas" }, { label: "設定" }]} />
            <h2>OA 編集</h2>
          </div>
        </div>
        <div className="card" style={{ maxWidth: 560 }}>
          {[1,2,3,4,5].map((i) => (
            <div key={i} className="form-group">
              <div className="skeleton" style={{ width: 80, height: 13, marginBottom: 4 }} />
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
            <Breadcrumb items={[{ label: "アカウントリスト", href: "/oas" }, { label: "設定" }]} />
            <h2>OA 編集</h2>
          </div>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <Breadcrumb items={[{ label: "アカウントリスト", href: "/oas" }, { label: "設定" }]} />
          <h2>{form!.title}</h2>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <form onSubmit={handleSubmit}>
          {/* ── 基本情報 ── */}
          <p style={{ fontWeight: 600, marginBottom: 16, color: "#374151" }}>基本情報</p>

          <div className="form-group">
            <label htmlFor="title">作品名 <span style={{ color: "#ef4444" }}>*</span></label>
            <input
              id="title"
              type="text"
              value={form!.title}
              onChange={(e) => setField("title", e.target.value)}
              maxLength={100}
              required
            />
            {errors.title?.map((m) => <p key={m} className="field-error">{m}</p>)}
          </div>

          <div className="form-group">
            <label htmlFor="description">説明（任意）</label>
            <textarea
              id="description"
              value={form!.description}
              onChange={(e) => setField("description", e.target.value)}
              maxLength={500}
            />
          </div>

          <div className="form-group">
            <label>公開ステータス</label>
            <div className="radio-group">
              {STATUS_OPTIONS.map(({ value, label }) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="publish_status"
                    value={value}
                    checked={form!.publish_status === value}
                    onChange={() => setField("publish_status", value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <hr className="section-divider" />

          {/* ── LINE 設定 ── */}
          <p style={{ fontWeight: 600, marginBottom: 4, color: "#374151" }}>LINE 接続設定</p>
          <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>
            変更しない場合もそのまま保存してください。
          </p>

          <div className="form-group">
            <label htmlFor="line_oa_id">
              LINE OA ID
              <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 400, marginLeft: 6 }}>
                Webhook URL 識別子
              </span>
            </label>
            <input
              id="line_oa_id"
              type="text"
              value={form!.line_oa_id}
              onChange={(e) => setField("line_oa_id", e.target.value.replace(/^@/, ""))}
              placeholder="例: 613zlngs（@ は不要）"
            />
            <p style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>
              LINE Developers → Basic information → Basic ID（@マークの後の文字列）
            </p>
            {form!.line_oa_id && (
              <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                Webhook URL: {`https://<your-domain>/api/line/`}<strong>{form!.line_oa_id}</strong>{`/webhook`}
              </p>
            )}
            {errors.line_oa_id?.map((m) => <p key={m} className="field-error">{m}</p>)}
          </div>

          <div className="form-group">
            <label htmlFor="channel_id">
              Channel ID <span style={{ color: "#ef4444" }}>*</span>
              <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 400, marginLeft: 6 }}>
                数値の API 認証用 ID
              </span>
            </label>
            <input
              id="channel_id"
              type="text"
              value={form!.channel_id}
              onChange={(e) => setField("channel_id", e.target.value)}
              required
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

          <hr className="section-divider" />

          {/* スプレッドシートモード */}
          <div className="card" style={{ marginBottom: 20 }}>
            <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: "#374151" }}>
              Google Sheets モード（任意）
            </p>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
              設定すると、シナリオデータを Google Spreadsheet から読み込みます。
              スプレッドシート側を編集するだけで Bot の挙動を変更できます。
            </p>
            <label style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
                スプレッドシート ID
              </span>
              <input
                type="text"
                className="input"
                value={form?.spreadsheet_id ?? ""}
                onChange={(e) => setForm((f) => f ? { ...f, spreadsheet_id: e.target.value } : f)}
                placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                style={{ fontFamily: "monospace", fontSize: 13 }}
              />
              <span style={{ fontSize: 11, color: "#9ca3af", display: "block", marginTop: 4 }}>
                スプレッドシート URL の /d/ と /edit の間の文字列。空欄にするとデータベースモードに戻ります。
              </span>
            </label>
            {form?.spreadsheet_id && (
              <div style={{
                marginTop: 10, padding: "8px 12px",
                background: "#f0fdf4", border: "1px solid #86efac",
                borderRadius: 8, fontSize: 12, color: "#15803d",
              }}>
                Sheets モード有効 — <a
                  href={`https://docs.google.com/spreadsheets/d/${form.spreadsheet_id}/edit`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ color: "#15803d", textDecoration: "underline" }}
                >スプレッドシートを開く</a>
              </div>
            )}
          </div>

          <div className="form-actions">
            <Link href="/oas" className="btn btn-ghost">キャンセル</Link>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting && <span className="spinner" />}
              {submitting ? "保存中..." : "変更を保存"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
