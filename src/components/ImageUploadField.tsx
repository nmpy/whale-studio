"use client";

// src/components/ImageUploadField.tsx
// 画像 URL 入力 + アップロード + プレビュー + 削除/差し替え を 1 つにまとめた汎用フィールド。
//
// 用途:
//   - LIFF ブロックの画像 / ロゴ / 動画ポスター
//   - キャラクターアイコン (circle preview + 縮小 URL 入力)
//   - 他、画像 URL を保存したいフォーム全般
//
// 仕様:
// - 既存の Cloudinary アップロード API (`/api/upload`) を再利用する。新規 API は増やさない。
// - 受け入れる形式 / 上限はデフォルト JPEG / PNG / WebP / GIF, 5MB。`accept` で上書き可能。
// - URL の手入力も並行で許可する (手入力 → アップロード切替が自然にできる)。
// - アップロード中はボタン disabled + "アップロード中..." 表記、エラーは inline 表示。
// - 値が設定されている間はプレビューを表示し、「差し替え」「削除」ができる。
// - プレビューは矩形 (デフォルト) と円形を切替可能。

import { useRef, useState } from "react";
import { uploadApi, getDevToken } from "@/lib/api-client";

interface Props {
  /** 現在の画像 URL (未設定なら空文字 or undefined) */
  value: string | undefined | null;
  /** URL 更新ハンドラ (空文字を渡すと削除扱い) */
  onChange: (next: string) => void;
  /** 入力欄のラベル文言 */
  label?: string;
  /** URL 手入力欄の placeholder */
  placeholder?: string;
  /** 入力 readonly */
  readOnly?: boolean;
  /** プレビューの最大高さ (px)。previewShape="rect" のみ参照される。デフォルト 120 */
  previewMaxHeight?: number;
  /** プレビュー形状。"rect" (デフォルト) または "circle" */
  previewShape?: "rect" | "circle";
  /** 円形プレビュー時の直径 (px)。デフォルト 120 */
  previewSize?: number;
  /** プレビュー画像の代替テキスト */
  previewAlt?: string;
  /** 受け入れ MIME (input[accept])。デフォルト JPEG/PNG/WebP/GIF */
  accept?: string;
  /** プレビュー下に出す対応形式テキスト。`accept` を変えるなら合わせて変えること */
  supportedFormatsText?: string;
  /** URL 手入力欄を `<details>` で折りたたむ。ラベル文字列を渡す */
  urlInputCollapsibleLabel?: string;
  /** 画像が未設定のときの中身 (circle/square 内で表示)。テキストやアイコンを差し込める */
  emptyContent?: React.ReactNode;
  /** 画像読み込み失敗時にも emptyContent を表示するか (デフォルト false) */
  showEmptyOnImageError?: boolean;
  /** エラー文言上書き */
  errors?: {
    invalidType?: string;
    tooLarge?: string;
    uploadFailed?: string;
  };
  /** クライアント側で最大サイズを事前チェック (バイト数)。指定なら API より先にチェック。 */
  clientMaxBytes?: number;
}

const DEFAULT_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const DEFAULT_FORMATS_TEXT = "対応形式: JPEG / PNG / WebP / GIF（最大 5MB）";
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

const inputCls =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 disabled:bg-gray-50 disabled:text-gray-500";
const labelCls = "block text-xs font-medium text-gray-600 mb-1";

function fileMatchesAccept(file: File, accept: string): boolean {
  const allowed = accept
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  const mime = file.type.toLowerCase();
  return allowed.some((a) => {
    if (a === mime) return true;
    if (a.endsWith("/*")) {
      const prefix = a.slice(0, -2);
      return mime.startsWith(prefix + "/");
    }
    return false;
  });
}

export function ImageUploadField({
  value,
  onChange,
  label,
  placeholder = "https://...",
  readOnly,
  previewMaxHeight = 120,
  previewShape = "rect",
  previewSize = 120,
  previewAlt,
  accept = DEFAULT_ACCEPT,
  supportedFormatsText = DEFAULT_FORMATS_TEXT,
  urlInputCollapsibleLabel,
  emptyContent,
  showEmptyOnImageError = false,
  errors,
  clientMaxBytes = DEFAULT_MAX_BYTES,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const url = (value ?? "").trim();
  const isCircle = previewShape === "circle";

  const errMsgs = {
    invalidType: errors?.invalidType ?? "対応していない画像形式です。",
    tooLarge: errors?.tooLarge ?? `画像サイズは ${Math.round(clientMaxBytes / 1024 / 1024)}MB 以内にしてください。`,
    uploadFailed: errors?.uploadFailed ?? "画像のアップロードに失敗しました。時間をおいて再度お試しください。",
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setImgFailed(false);

    if (!fileMatchesAccept(file, accept)) {
      setError(errMsgs.invalidType);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > clientMaxBytes) {
      setError(errMsgs.tooLarge);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    try {
      const result = await uploadApi.uploadImage(getDevToken(), file);
      onChange(result.url);
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : errMsgs.uploadFailed;
      setError(msg);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ── プレビュー (URL あり) ──
  const previewWithImage = url && !(showEmptyOnImageError && imgFailed);
  const renderPreview = () => {
    if (isCircle) {
      const size = previewSize;
      const shared: React.CSSProperties = {
        width: size,
        height: size,
        borderRadius: "50%",
        border: "2px solid #e5e5e5",
        background: "#f3f4f6",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
      };
      return (
        <div style={shared}>
          {previewWithImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={previewAlt ?? "画像プレビュー"}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={() => {
                setImgFailed(true);
                if (!showEmptyOnImageError) {
                  setError("画像を読み込めませんでした。URL を確認してください");
                }
              }}
            />
          ) : (
            <div style={{ color: "#9ca3af", fontSize: 24 }}>{emptyContent ?? "?"}</div>
          )}
        </div>
      );
    }
    // rect
    if (!previewWithImage) {
      // 矩形プレビューでは emptyContent が無い場合は何も描画しない (LIFF 既存挙動)
      if (!emptyContent) return null;
      return (
        <div
          className="rounded-md border border-gray-200 bg-gray-50 flex items-center justify-center text-gray-400"
          style={{ height: previewMaxHeight }}
        >
          {emptyContent}
        </div>
      );
    }
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={previewAlt ?? "画像プレビュー"}
          className="rounded-md border border-gray-200 object-contain bg-gray-50"
          style={{ maxHeight: previewMaxHeight, maxWidth: "100%" }}
          onError={() => {
            setImgFailed(true);
            if (!showEmptyOnImageError) {
              setError("画像を読み込めませんでした。URL を確認してください");
            }
          }}
        />
        <p className="text-[11px] text-gray-400 mt-1">{supportedFormatsText}</p>
      </>
    );
  };

  const urlInput = (
    <input
      type="url"
      className={inputCls}
      value={url}
      onChange={(e) => onChange(e.target.value)}
      disabled={readOnly || uploading}
      placeholder={placeholder}
    />
  );

  const actions = !readOnly && (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="inline-flex items-center px-3 py-1.5 bg-violet-50 border border-violet-200 rounded-md text-xs text-violet-700 cursor-pointer hover:bg-violet-100 select-none">
        {uploading
          ? "アップロード中..."
          : url
            ? "画像を差し替える"
            : "画像をアップロード"}
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          disabled={uploading}
          onChange={(e) => handleFile(e.target.files?.[0])}
          className="hidden"
        />
      </label>

      {url && !uploading && (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setImgFailed(false);
            onChange("");
          }}
          className="px-3 py-1.5 border border-gray-200 text-gray-600 rounded-md text-xs hover:bg-gray-50"
        >
          画像を削除
        </button>
      )}

      {error && (
        <span className="text-xs text-red-600 break-all">{error}</span>
      )}
    </div>
  );

  return (
    <div>
      {label && <label className={labelCls}>{label}</label>}

      {/* circle はプレビューを「先に」上に置いてからアップロード操作を出すレイアウト。
          rect は LIFF 既存どおり「URL → 操作 → プレビュー」順を維持。 */}
      {isCircle ? (
        <div className="flex items-center gap-4">
          {renderPreview()}
          <div className="flex-1 min-w-0">
            {actions}
            <p className="text-[11px] text-gray-400 mt-2">{supportedFormatsText}</p>
          </div>
        </div>
      ) : (
        <>
          {urlInputCollapsibleLabel ? (
            <details className="mb-2">
              <summary className="text-xs text-gray-600 cursor-pointer select-none">
                {urlInputCollapsibleLabel}
              </summary>
              <div className="mt-2">{urlInput}</div>
            </details>
          ) : (
            urlInput
          )}
          {actions}
          {previewWithImage && <div className="mt-2">{renderPreview()}</div>}
        </>
      )}

      {/* circle のとき、URL 入力はプレビュー外の折りたたみ要素として出す */}
      {isCircle && (
        <div className="mt-3">
          {urlInputCollapsibleLabel ? (
            <details>
              <summary className="text-xs text-gray-600 cursor-pointer select-none">
                {urlInputCollapsibleLabel}
              </summary>
              <div className="mt-2">{urlInput}</div>
            </details>
          ) : (
            urlInput
          )}
        </div>
      )}
    </div>
  );
}
