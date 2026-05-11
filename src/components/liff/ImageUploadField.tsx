"use client";

// src/components/liff/ImageUploadField.tsx
// 画像 URL 入力 + アップロード + プレビュー + 削除/差し替え を 1 つにまとめた共通フィールド。
//
// 仕様:
// - 既存の Cloudinary アップロード API (`/api/upload`) を再利用する。新規 API は増やさない。
// - 受け入れる形式 / 上限は API 側に従う（JPEG / PNG / WebP / GIF, 5MB）。
// - URL の手入力も並行で許可する（手入力 → アップロード切替が自然にできる）。
// - アップロード中はボタン disabled + "アップロード中..." 表記、エラーは inline 表示。
// - 値が設定されている間はプレビューを表示し、「差し替え」「削除」ができる。

import { useRef, useState } from "react";
import { uploadApi, getDevToken } from "@/lib/api-client";

interface Props {
  /** 現在の画像 URL（未設定なら空文字 or undefined） */
  value: string | undefined | null;
  /** URL 更新ハンドラ（空文字を渡すと削除扱い） */
  onChange: (next: string) => void;
  /** 入力欄のラベル文言 */
  label?: string;
  /** プレースホルダ */
  placeholder?: string;
  /** 入力 readonly */
  readOnly?: boolean;
  /** プレビューの最大高さ (px)。未指定なら 120 */
  previewMaxHeight?: number;
  /** プレビュー画像の代替テキスト */
  previewAlt?: string;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

const inputCls =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 disabled:bg-gray-50 disabled:text-gray-500";
const labelCls = "block text-xs font-medium text-gray-600 mb-1";

export function ImageUploadField({
  value,
  onChange,
  label,
  placeholder = "https://...",
  readOnly,
  previewMaxHeight = 120,
  previewAlt,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = (value ?? "").trim();

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadApi.uploadImage(getDevToken(), file);
      onChange(result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "アップロードに失敗しました");
    } finally {
      setUploading(false);
      // 同じファイルを再選択できるようリセットしておく
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div>
      {label && <label className={labelCls}>{label}</label>}

      <input
        type="url"
        className={inputCls}
        value={url}
        onChange={(e) => onChange(e.target.value)}
        disabled={readOnly || uploading}
        placeholder={placeholder}
      />

      {!readOnly && (
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
              accept={ACCEPT}
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
      )}

      {url && (
        <div className="mt-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={previewAlt ?? "画像プレビュー"}
            className="rounded-md border border-gray-200 object-contain bg-gray-50"
            style={{ maxHeight: previewMaxHeight, maxWidth: "100%" }}
            onError={() => setError("画像を読み込めませんでした。URL を確認してください")}
          />
          <p className="text-[11px] text-gray-400 mt-1">対応形式: JPEG / PNG / WebP / GIF（最大 5MB）</p>
        </div>
      )}
    </div>
  );
}
