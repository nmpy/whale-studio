"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { oaApi, trackingApi, getDevToken } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";

function generateTrackingId(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase() +
         Math.random().toString(36).substring(2, 6).toUpperCase();
}

function buildTrackingUrl(targetUrl: string, trackingId: string, utmEnabled: boolean): string {
  if (!targetUrl || !trackingId) return "";
  try {
    const url = new URL(targetUrl);
    if (utmEnabled) {
      url.searchParams.set("utm_source", "line");
      url.searchParams.set("utm_medium", "official_account");
      url.searchParams.set("utm_campaign", trackingId);
    } else {
      url.searchParams.set("trk", trackingId);
    }
    return url.toString();
  } catch {
    return targetUrl;
  }
}

export default function NewTrackingPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;
  const router = useRouter();
  const { showToast } = useToast();

  const [oaTitle, setOaTitle]       = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied]         = useState(false);

  const [form, setForm] = useState({
    name:        "",
    tracking_id: generateTrackingId(),
    target_url:  "",
    utm_enabled: true,
  });

  const trackingUrl = buildTrackingUrl(form.target_url, form.tracking_id, form.utm_enabled);

  useEffect(() => {
    oaApi.get(getDevToken(), oaId).then((oa) => setOaTitle(oa.title)).catch(() => {});
  }, [oaId]);

  function reissueId() {
    setForm((f) => ({ ...f, tracking_id: generateTrackingId() }));
  }

  async function copyUrl() {
    if (!trackingUrl) return;
    try {
      await navigator.clipboard.writeText(trackingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("コピーに失敗しました", "error");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { showToast("トラッキング名を入力してください", "error"); return; }
    if (!form.target_url.trim()) { showToast("計測対象 URL を入力してください", "error"); return; }
    setSubmitting(true);
    try {
      await trackingApi.create(getDevToken(), {
        oa_id:       oaId,
        name:        form.name.trim(),
        tracking_id: form.tracking_id,
        target_url:  form.target_url.trim(),
        utm_enabled: form.utm_enabled,
      });
      showToast("トラッキングを作成しました", "success");
      router.push(`/oas/${oaId}/audience?tab=tracking`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "作成に失敗しました", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "設定", href: `/oas/${oaId}/settings` },
            { label: "オーディエンス", href: `/oas/${oaId}/audience?tab=tracking` },
            { label: "新規作成" },
          ]} />
          <h2>トラッキングを作成</h2>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 600 }}>
        <form onSubmit={handleSubmit}>
          {/* トラッキング名 */}
          <div className="form-group">
            <label htmlFor="name">トラッキング名 <span style={{ color: "#ef4444" }}>*</span></label>
            <input id="name" type="text" className="form-input"
              value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="例: Instagram 広告 2024-03" maxLength={100} />
          </div>

          {/* トラッキングID */}
          <div className="form-group">
            <label htmlFor="tracking_id">トラッキングID</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input id="tracking_id" type="text" className="form-input"
                value={form.tracking_id}
                onChange={(e) => setForm((f) => ({ ...f, tracking_id: e.target.value.toUpperCase() }))}
                style={{ fontFamily: "monospace", fontSize: 13, flex: 1 }}
                maxLength={64} />
              <button type="button" className="btn btn-ghost" onClick={reissueId}
                style={{ padding: "8px 14px", fontSize: 12, whiteSpace: "nowrap", flexShrink: 0 }}>
                🔄 再発行
              </button>
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>
              トラッキング URL に付与される一意の識別子です
            </div>
          </div>

          {/* 計測対象URL */}
          <div className="form-group">
            <label htmlFor="target_url">計測対象 URL <span style={{ color: "#ef4444" }}>*</span></label>
            <input id="target_url" type="url" className="form-input"
              value={form.target_url} onChange={(e) => setForm((f) => ({ ...f, target_url: e.target.value }))}
              placeholder="https://example.com/campaign"
              style={{ fontFamily: "monospace", fontSize: 13 }} />
          </div>

          {/* UTMパラメータ */}
          <div className="form-group">
            <label>UTM パラメータ</label>
            <div style={{ display: "flex", gap: 10 }}>
              {([true, false] as const).map((v) => (
                <label key={String(v)} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 16px",
                  border: `2px solid ${form.utm_enabled === v ? (v ? "#06C755" : "#6b7280") : "#e5e5e5"}`,
                  borderRadius: 8, cursor: "pointer",
                  background: form.utm_enabled === v ? (v ? "#E6F7ED" : "#f3f4f6") : "#fff",
                }}>
                  <input type="radio" name="utm_enabled" checked={form.utm_enabled === v}
                    onChange={() => setForm((f) => ({ ...f, utm_enabled: v }))} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{v ? "有効" : "無効"}</div>
                    <div style={{ fontSize: 10, color: "#9ca3af" }}>
                      {v ? "utm_source, utm_medium, utm_campaign を付与" : "trk パラメータのみ付与"}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* トラッキングURL (プレビュー) */}
          <div className="form-group">
            <label>トラッキング URL</label>
            <div style={{
              background: "#f9fafb", border: "1px solid #e5e5e5", borderRadius: 8,
              padding: "12px 14px",
            }}>
              {trackingUrl ? (
                <>
                  <div style={{
                    fontSize: 12, fontFamily: "monospace", color: "#374151",
                    wordBreak: "break-all", lineHeight: 1.6, marginBottom: 8,
                  }}>
                    {trackingUrl}
                  </div>
                  <button type="button" className="btn btn-ghost"
                    style={{ fontSize: 12, padding: "4px 12px" }}
                    onClick={copyUrl}>
                    {copied ? "✅ コピー済み" : "📋 コピー"}
                  </button>
                </>
              ) : (
                <div style={{ fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}>
                  計測対象 URL を入力するとプレビューが表示されます
                </div>
              )}
            </div>
          </div>

          <div className="form-actions">
            <Link href={`/oas/${oaId}/audience?tab=tracking`} className="btn btn-ghost">キャンセル</Link>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting && <span className="spinner" />}
              {submitting ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
