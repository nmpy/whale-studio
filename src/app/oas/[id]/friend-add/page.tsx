"use client";

// src/app/oas/[id]/friend-add/page.tsx
// GET /api/oas/:id/friend-add  → フォームプリフィル（404 = 未設定・正常系）
// PUT /api/oas/:id/friend-add  → upsert 保存
// POST /api/upload             → シェア用画像アップロード
//
// Phase 4.3: UI を Phase 0 トークン + shared/Button + buttonClass に揃える。
// 画像アップロードは独自実装維持 (ImageUploadField には統一しない)。
// LINE 連携 UI の中核として LINE Green (= --color-line-brand と inline 淡色) を維持。
// friendAddApi / oaApi / uploadApi / API route / 認可 / payload / 404 / ValidationError
// / 画像 upload・clear・preview / QR 生成 / toast 文言 / button 文言 / placeholder /
// helper 文言は完全維持。useWorkspaceRole / ViewerBanner は追加しない (= 既存挙動)。

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { friendAddApi, oaApi, uploadApi, getDevToken, NotFoundError, ValidationError } from "@/lib/api-client";
import { Breadcrumb } from "@/components/Breadcrumb";
import { useToast } from "@/components/Toast";
import { Button, buttonClass } from "@/components/shared";

interface FormState {
  campaign_name:   string;
  add_url:         string;
  share_image_url: string; // アップロード後の URL、または既存 URL
}

const EMPTY_FORM: FormState = { campaign_name: "", add_url: "", share_image_url: "" };

// ── ローカル共通: 必須マーク (= /account / works edit と同じパターン) ──
function RequiredMark() {
  return <span aria-hidden="true" className="ml-0.5 text-danger">*</span>;
}

// ── 共通スタイル: 行内 input (= Phase 3.1 compactInputClass) ──
const compactInputClass =
  "rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-ink " +
  "placeholder:text-ink-3 transition-shadow focus:border-brand focus:outline-none " +
  "focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-bg-tint " +
  "disabled:text-ink-3";

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

  // ── ヘッダー (loading / error / 通常で共用) ──
  const header = (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <Breadcrumb items={[
          { label: "アカウントリスト", href: "/oas" },
          { label: "設定", href: `/oas/${oaId}/settings` },
          { label: "友だち追加" },
        ]} />
        <h2 className="font-round mt-1 text-[clamp(20px,4vw,24px)] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink">
          友だち追加設定
        </h2>
        {!loading && !loadError && (
          <p className="mt-1 text-[13px] text-ink-2">
            LINE公式アカウントへの友だち追加URL・シェア用画像を管理します。
          </p>
        )}
      </div>
    </div>
  );

  // ── ローディング ──────────────────────────────
  if (loading) {
    return (
      <>
        {header}
        <div
          role="status"
          aria-busy="true"
          className="w-full max-w-[560px] rounded-card border border-line bg-surface p-5 shadow-sm sm:p-6"
        >
          {[1, 2, 3].map((i) => (
            <div key={i} className="mb-5">
              <div className="skeleton" style={{ width: 120, height: 13, marginBottom: 4 }} />
              <div className="skeleton" style={{ height: 36 }} />
            </div>
          ))}
          <span className="sr-only">読み込み中...</span>
        </div>
      </>
    );
  }

  // ── 本当の通信エラー（404 以外）──────────────
  if (loadError) {
    return (
      <>
        {header}
        <div
          role="alert"
          className="w-full max-w-[560px] rounded-field border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] leading-[1.6] text-danger"
        >
          {loadError}
        </div>
      </>
    );
  }

  return (
    <>
      {header}

      {/* 未設定案内 */}
      {isNew && (
        <div
          role="status"
          className="mb-5 w-full max-w-[560px] rounded-field border border-sky/30 bg-sky-soft px-4 py-3 text-[13px] leading-[1.6] text-sky-ink"
        >
          まだ友だち追加設定が登録されていません。入力して保存してください。
        </div>
      )}

      <div className="w-full max-w-[560px] rounded-card border border-line bg-surface p-5 shadow-sm sm:p-6">
        <form onSubmit={handleSubmit}>

          {/* ── 友だち追加 URL ── */}
          <div className="mb-5">
            <label htmlFor="add_url" className="mb-1.5 block text-[13px] font-bold text-ink">
              友だち追加 URL<RequiredMark />
            </label>
            <input
              id="add_url"
              type="url"
              value={form.add_url}
              onChange={(e) => setField("add_url", e.target.value)}
              placeholder="https://lin.ee/xxxxxxx"
              className={compactInputClass + " w-full font-mono"}
              aria-required="true"
              aria-invalid={errors.add_url ? "true" : undefined}
              aria-describedby={errors.add_url ? "add_url-error" : "add_url-help"}
            />
            <span id="add_url-help" className="mt-1 block text-[11px] text-ink-3">
              LINE Official Account Manager の「友だち追加ガイド」から取得できます
            </span>
            {errors.add_url && (
              <p id="add_url-error" role="alert" className="mt-1 text-[12px] text-danger">{errors.add_url}</p>
            )}
          </div>

          {/* 友だち追加リンクプレビュー + QRコード (= LINE Green 維持) */}
          {form.add_url && /^https?:\/\//.test(form.add_url) && (
            <div
              className="mb-5 flex flex-wrap items-start gap-4 rounded-field border p-4"
              style={{ background: "#f0fdf4", borderColor: "#86efac" }}
            >
              {/* テキスト + ボタン */}
              <div className="min-w-[160px] flex-1">
                <p
                  className="mb-1.5 text-[11px] font-bold"
                  style={{ color: "#15803d" }}
                >
                  プレビュー
                </p>
                <a
                  href={form.add_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClass({ variant: "primary", size: "sm" }) + " mb-2 no-underline"}
                >
                  友だち追加URLを開く
                </a>
                <p
                  className="break-all text-[11px] leading-[1.5]"
                  style={{ color: "#15803d" }}
                >
                  {form.add_url}
                </p>
              </div>

              {/* QRコード */}
              <div className="flex-shrink-0 text-center">
                <p
                  className="mb-1.5 text-[11px]"
                  style={{ color: "#15803d" }}
                >
                  QRコードで追加
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&margin=4&data=${encodeURIComponent(form.add_url)}`}
                  alt="友だち追加QRコード"
                  width={120}
                  height={120}
                  className="block rounded-md"
                  style={{ border: "1px solid #86efac" }}
                />
              </div>
            </div>
          )}

          {/* ── キャンペーン名 ── */}
          <div className="mb-5">
            <label htmlFor="campaign_name" className="mb-1.5 block text-[13px] font-bold text-ink">
              キャンペーン名（任意）
            </label>
            <input
              id="campaign_name"
              type="text"
              value={form.campaign_name}
              onChange={(e) => setField("campaign_name", e.target.value)}
              placeholder="例: 春の作品キャンペーン"
              maxLength={100}
              className={compactInputClass + " w-full"}
              aria-describedby="campaign_name-help"
            />
            <span id="campaign_name-help" className="mt-1 block text-[11px] text-ink-3">
              管理用のメモ。ユーザーには表示されません
            </span>
          </div>

          <hr className="my-5 border-t border-line-2" />

          {/* ── シェア用画像 ── */}
          <div className="mb-5">
            <label className="mb-1.5 block text-[13px] font-bold text-ink">シェア用画像（任意）</label>
            <p className="mb-2.5 text-[12px] leading-[1.6] text-ink-2">
              URL をシェアすると自動で表示される画像です。<br />
              実際の画像には、あなたのアカウントのアカウント名、ID、QR コードが表示されます。
            </p>
            <p className="mb-2.5 text-[11px] text-ink-3">
              推奨サイズ: 1200 × 630 px（JPEG / PNG / WebP）・最大 5 MB
            </p>

            {/* プレビュー表示 */}
            {imagePreview ? (
              <div className="mb-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePreview}
                  alt="シェア用画像プレビュー"
                  className="block w-full max-w-[400px] rounded-md border border-line bg-bg-tint object-cover"
                  style={{ aspectRatio: "1200 / 630" }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    aria-busy={uploading || undefined}
                  >
                    {uploading ? <><span className="spinner" aria-hidden="true" /> アップロード中...</> : "画像を変更"}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={handleImageClear}
                    disabled={uploading}
                  >
                    削除
                  </Button>
                </div>
              </div>
            ) : (
              /* アップロードエリア (= LINE Green hover 維持) */
              <div
                role="button"
                tabIndex={0}
                aria-busy={uploading || undefined}
                onClick={() => !uploading && fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && !uploading && fileInputRef.current?.click()}
                className={
                  "mb-2 rounded-card border-2 border-dashed border-line-2 bg-bg-tint px-5 py-8 text-center transition-colors " +
                  (uploading ? "cursor-wait" : "cursor-pointer")
                }
                onMouseEnter={(e) => {
                  if (!uploading) {
                    (e.currentTarget as HTMLDivElement).style.borderColor = "#06C755";
                    (e.currentTarget as HTMLDivElement).style.background   = "#E6F7ED";
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = "";
                  (e.currentTarget as HTMLDivElement).style.background   = "";
                }}
              >
                {uploading ? (
                  <div className="flex items-center justify-center gap-2 text-[13px] text-ink-2">
                    <span className="spinner" aria-hidden="true" />
                    アップロード中...
                  </div>
                ) : (
                  <>
                    <div className="mb-2 text-[28px]" aria-hidden="true">🖼</div>
                    <p className="mb-1 text-[13px] font-medium text-ink">
                      クリックして画像を選択
                    </p>
                    <p className="text-[11px] text-ink-3">
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
              className="hidden"
              onChange={handleFileChange}
            />
            {errors.share_image_url && (
              <p role="alert" className="mt-1 text-[12px] text-danger">{errors.share_image_url}</p>
            )}
          </div>

          {/* ── 保存ボタン ── */}
          <div className="mt-7 flex flex-col-reverse items-stretch gap-3 border-t border-line-2 pt-5 sm:flex-row sm:items-center sm:justify-end">
            <Link
              href={`/oas/${oaId}/settings`}
              className={buttonClass({ variant: "ghost", size: "md" })}
            >
              キャンセル
            </Link>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={submitting || uploading}
              aria-busy={submitting || undefined}
            >
              {submitting && <span className="spinner" aria-hidden="true" />}
              {submitting ? "保存中..." : isNew ? "設定を登録" : "設定を保存"}
            </Button>
          </div>

        </form>
      </div>
    </>
  );
}
