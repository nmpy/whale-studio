"use client";

// src/components/MediaUploadButton.tsx
// 動画 / 音声を直接アップロードするボタン（URL入力欄の補助）。
// 成功時に public URL を onUploaded(url) で返し、既存の動画/音声 URL フィールドへ反映させる。
// 既存の画像アップロード（ImageUploader）には影響しない。POST /api/upload/media を使う。

import { useRef, useState } from "react";
import { uploadApi, getDevToken } from "@/lib/api-client";

// クライアント側の許可 MIME（サーバ /api/upload/media と整合）。
const VIDEO_MIME = ["video/mp4", "video/quicktime", "video/webm"];
const AUDIO_MIME = ["audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav"];
const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm";
const AUDIO_ACCEPT = "audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/aac";
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB（サーバ上限と整合 / Vercel body 上限内）

export function MediaUploadButton({
  mediaType, oaId, workId, onUploaded, disabled,
}: {
  mediaType: "video" | "audio";
  oaId: string;
  workId: string;
  onUploaded: (url: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isVideo = mediaType === "video";
  const label = isVideo ? "動画をアップロード" : "音声をアップロード";
  const accept = isVideo ? VIDEO_ACCEPT : AUDIO_ACCEPT;
  const allowed = isVideo ? VIDEO_MIME : AUDIO_MIME;

  async function handleFile(file: File | undefined | null) {
    setError(null);
    if (!file) return; // 未選択でクラッシュしない
    // mediaType と MIME の整合性チェック（動画欄に音声 / 音声欄に動画 を弾く）。
    if (!allowed.includes(file.type)) {
      setError(isVideo ? "動画ファイル（mp4 / mov / webm）を選択してください" : "音声ファイル（mp3 / m4a / wav / aac）を選択してください");
      return;
    }
    if (file.size === 0) { setError("ファイルが空です"); return; }
    if (file.size > MAX_BYTES) {
      setError(`ファイルサイズは ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB 以下にしてください（受信: ${(file.size / 1024 / 1024).toFixed(1)} MB）`);
      return;
    }
    setUploading(true);
    try {
      const { url } = await uploadApi.uploadMedia(getDevToken(), file, { mediaType, oaId, workId });
      if (url && /^https?:\/\//i.test(url)) {
        onUploaded(url);
      } else {
        setError("アップロード結果のURLが不正です");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ marginTop: 6 }}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => { handleFile(e.target.files?.[0]); e.currentTarget.value = ""; }}
      />
      <button
        type="button"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "6px 14px", fontSize: 12, fontWeight: 600,
          color: uploading ? "#9ca3af" : "#374151",
          background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 8,
          cursor: disabled || uploading ? "not-allowed" : "pointer",
        }}
      >
        {uploading ? "アップロード中…" : `⬆ ${label}`}
      </button>
      <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: 8 }}>
        最大4MB（{isVideo ? "mp4 / mov / webm" : "mp3 / m4a / wav / aac"}）。手入力も可。
      </span>
      {error && <p style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>{error}</p>}
    </div>
  );
}
