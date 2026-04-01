"use client";

// src/app/oas/[id]/friend-add/page.tsx
// GET /api/oas/:id/friend-add  → フォームプリフィル（404 = 未設定・正常系）
// PUT /api/oas/:id/friend-add  → upsert 保存
// POST /api/upload             → シェア用画像アップロード

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { friendAddApi, oaApi, uploadApi, getDevToken, NotFoundError, ValidationError } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";

interface FormState {
  campaign_name:   string;
  add_url:         string;
  share_image_url: string; // アップロード後の URL、または既存 URL
}

const EMPTY_FORM: FormState = { campaign_name: "", add_url: "", share_image_url: "" };

export default function FriendAddPage() {
  const params = useParams<{ id: string }>();
  const oaId   = params.id;
  const { showToast } = useToast();

  const [oaTitle, setOaTitle]       = useState("");
  const [form, setForm]             = useState<FormState>(EMPTY_FORM);
  const [isNew, setIsNew]           = useState(false);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [errors, setErrors]         = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // 画像アップロード関連
  const fileInputRef                  = useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = useState<string>("");   // Object URL or server URL
  const [uploading, setUploading]       = useState(false);

  // ── 初期読み込み ──────────────────────────────
  useEffect(() => {
    const token = getDevToken();
    setLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const oa = await oaApi.get(token, oaId);
        setOaTitle(oa.title);

        try {
          const settings = await friendAddApi.get(token, oaId);
          setForm({
            campaign_name:   settings.campaign_name   ?? "",
            add_url:         settings.add_url,
            share_image_url: settings.share_image_url ?? "",
          });
          setImagePreview(settings.share_image_url ?? "");
          setIsNew(false);
        } catch (e) {
          if (e instanceof NotFoundError) {
            setForm(EMPTY_FORM);
            setImagePreview("");
            setIsNew(true);
          } else {
            throw e;
          }
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    })();
  }, [oaId]);

  function setField<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  }

  // ── 画像ファイル選択 ──────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // ローカルプレビューを即時表示
    const objectUrl = URL.createObjectURL(file);
    setImagePreview(objectUrl);

    // アップロード
    setUploading(true);
    try {
      const { url } = await uploadApi.uploadImage(getDevToken(), file);
      // Object URL を解放してサーバー URL に切り替え
      URL.revokeObjectURL(objectUrl);
      setImagePreview(url);
      setField("share_image_url", url);
      showToast("画像をアップロードしました", "success");
    } catch (err) {
      URL.revokeObjectURL(objectUrl);
      setImagePreview(form.share_image_url); // 失敗時は元に戻す
      showToast(err instanceof Error ? err.message : "アップロードに失敗しました", "error");
    } finally {
      setUploading(false);
      // input をリセット（同じファイルを再選択できるよう）
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // ── 画像クリア ────────────────────────────────
  function handleImageClear() {
    setImagePreview("");
    setField("share_image_url", "");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── 保存 ──────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const errs: Record<string, string> = {};
    if (!form.add_url.trim())
      errs.add_url = "友だち追加 URL は必須です";
    else if (!/^https?:\/\//.test(form.add_url.trim()))
      errs.add_url = "有効な URL を入力してください";
    if (Object.keys(errs).length) { setErrors(errs); return; }

    const putPayload = {
      add_url:         form.add_url.trim(),
      campaign_name:   form.campaign_name.trim() || null,
      share_image_url: form.share_image_url      || null,
    };
    console.log("[friend-add] PUT payload:", JSON.stringify(putPayload));

    setSubmitting(true);
    try {
      await friendAddApi.put(getDevToken(), oaId, putPayload);
      setIsNew(false);
      showToast("友だち追加設定を保存しました", "success");
    } catch (err) {
      if (err instanceof ValidationError) {
        // フィールド別エラーを画面に反映 + トーストで具体化
        const fieldErrs: Record<string, string> = {};
        for (const [field, msgs] of Object.entries(err.details)) {
          fieldErrs[field] = msgs[0] ?? "入力値が不正です";
        }
        if (Object.keys(fieldErrs).length) setErrors((prev) => ({ ...prev, ...fieldErrs }));
        // トーストにはフィールド名付きの最初のエラーを表示
        showToast(err.toDetailString().split("\n")[0], "error");
      } else {
        showToast(err instanceof Error ? err.message : "保存に失敗しました", "error");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── ローディング ──────────────────────────────
  if (loading) {
    return (
      <>
        <div className="page-header">
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "設定", href: `/oas/${oaId}/settings` },
            { label: "友だち追加" },
          ]} />
          <h2>友だち追加設定</h2>
        </div>
        <div className="card" style={{ maxWidth: 560 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="form-group">
              <div className="skeleton" style={{ width: 120, height: 13, marginBottom: 4 }} />
              <div className="skeleton" style={{ height: 36 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  // ── 本当の通信エラー（404 以外）──────────────
  if (loadError) {
    return (
      <>
        <div className="page-header">
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "設定", href: `/oas/${oaId}/settings` },
            { label: "友だち追加" },
          ]} />
          <h2>友だち追加設定</h2>
        </div>
        <div className="alert alert-error">{loadError}</div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <Breadcrumb items={[
            { label: "アカウントリスト", href: "/oas" },
            { label: "設定", href: `/oas/${oaId}/settings` },
            { label: "友だち追加" },
          ]} />
          <h2>友だち追加設定</h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            LINE公式アカウントへの友だち追加URL・シェア用画像を管理します。
          </p>
        </div>
      </div>

      {/* 未設定案内 */}
      {isNew && (
        <div className="alert alert-info" style={{ maxWidth: 560, marginBottom: 20 }}>
          まだ友だち追加設定が登録されていません。入力して保存してください。
        </div>
      )}

      <div className="card" style={{ maxWidth: 560 }}>
        <form onSubmit={handleSubmit}>

          {/* ── 友だち追加 URL ── */}
          <div className="form-group">
            <label htmlFor="add_url">
              友だち追加 URL <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              id="add_url"
              type="url"
              value={form.add_url}
              onChange={(e) => setField("add_url", e.target.value)}
              placeholder="https://lin.ee/xxxxxxx"
              style={{ fontFamily: "monospace", fontSize: 13 }}
            />
            <span style={{ fontSize: 11, color: "#9ca3af", display: "block", marginTop: 4 }}>
              LINE Official Account Manager の「友だち追加ガイド」から取得できます
            </span>
            {errors.add_url && <p className="field-error">{errors.add_url}</p>}
          </div>

          {/* 友だち追加リンクプレビュー */}
          {form.add_url && /^https?:\/\//.test(form.add_url) && (
            <div style={{
              marginBottom: 20, padding: "10px 14px",
              background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8,
              fontSize: 12, color: "#15803d",
            }}>
              <a
                href={form.add_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#15803d", textDecoration: "underline" }}
              >
                友だち追加リンクを開く →
              </a>
            </div>
          )}

          {/* ── キャンペーン名 ── */}
          <div className="form-group">
            <label htmlFor="campaign_name">キャンペーン名（任意）</label>
            <input
              id="campaign_name"
              type="text"
              value={form.campaign_name}
              onChange={(e) => setField("campaign_name", e.target.value)}
              placeholder="例: 春の謎解きキャンペーン"
              maxLength={100}
            />
            <span style={{ fontSize: 11, color: "#9ca3af", display: "block", marginTop: 4 }}>
              管理用のメモ。ユーザーには表示されません
            </span>
          </div>

          <hr className="section-divider" />

          {/* ── シェア用画像 ── */}
          <div className="form-group">
            <label>シェア用画像（任意）</label>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 10, lineHeight: 1.6 }}>
              URL をシェアすると自動で表示される画像です。<br />
              実際の画像には、あなたのアカウントのアカウント名、ID、QR コードが表示されます。
            </p>
            <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 10 }}>
              推奨サイズ: 1200 × 630 px（JPEG / PNG / WebP）・最大 5 MB
            </p>

            {/* プレビュー表示 */}
            {imagePreview ? (
              <div style={{ marginBottom: 12 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePreview}
                  alt="シェア用画像プレビュー"
                  style={{
                    width: "100%", maxWidth: 400,
                    aspectRatio: "1200 / 630",
                    objectFit: "cover",
                    borderRadius: 8,
                    border: "1px solid #e5e5e5",
                    display: "block",
                    background: "#f3f4f6",
                  }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: "4px 12px" }}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? <><span className="spinner" /> アップロード中...</> : "画像を変更"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: "4px 12px", color: "#ef4444", borderColor: "#fecaca" }}
                    onClick={handleImageClear}
                    disabled={uploading}
                  >
                    削除
                  </button>
                </div>
              </div>
            ) : (
              /* アップロードエリア */
              <div
                role="button"
                tabIndex={0}
                onClick={() => !uploading && fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && !uploading && fileInputRef.current?.click()}
                style={{
                  border: "2px dashed #d1d5db",
                  borderRadius: 10,
                  padding: "32px 20px",
                  textAlign: "center",
                  cursor: uploading ? "wait" : "pointer",
                  background: "#fafafa",
                  transition: "border-color .15s, background .15s",
                  marginBottom: 8,
                }}
                onMouseEnter={(e) => {
                  if (!uploading) {
                    (e.currentTarget as HTMLDivElement).style.borderColor = "#06C755";
                    (e.currentTarget as HTMLDivElement).style.background   = "#E6F7ED";
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = "#d1d5db";
                  (e.currentTarget as HTMLDivElement).style.background   = "#fafafa";
                }}
              >
                {uploading ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#6b7280", fontSize: 13 }}>
                    <span className="spinner" style={{ borderColor: "#6b7280", borderTopColor: "transparent" }} />
                    アップロード中...
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>🖼</div>
                    <p style={{ fontSize: 13, color: "#374151", fontWeight: 500, marginBottom: 4 }}>
                      クリックして画像を選択
                    </p>
                    <p style={{ fontSize: 11, color: "#9ca3af" }}>
                      JPEG / PNG / WebP / GIF・最大 5 MB
                    </p>
                  </>
                )}
              </div>
            )}

            {/* hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            {errors.share_image_url && (
              <p className="field-error">{errors.share_image_url}</p>
            )}
          </div>

          {/* ── 保存ボタン ── */}
          <div className="form-actions">
            <Link href={`/oas/${oaId}/settings`} className="btn btn-ghost">キャンセル</Link>
            <button type="submit" className="btn btn-primary" disabled={submitting || uploading}>
              {submitting && <span className="spinner" />}
              {submitting ? "保存中..." : isNew ? "設定を登録" : "設定を保存"}
            </button>
          </div>

        </form>
      </div>
    </>
  );
}
