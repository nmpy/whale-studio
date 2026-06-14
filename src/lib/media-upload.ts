// src/lib/media-upload.ts
// 動画 / 音声のクライアント直アップロード（signed upload URL 方式）。
//   1. /api/upload/media にメタ情報を送り、署名付きアップロード token / path / publicUrl を取得
//   2. 取得した token で Supabase Storage へ「ブラウザから直接」アップロード（Vercel body 上限を回避）
//   3. 恒久 public URL を返す（保存値にはこの publicUrl のみを使う。signed URL は保存しない）
//
// 既存の画像アップロード（/api/upload, /api/upload/storage, ImageUploader）には影響しない。

import { createClient } from "@supabase/supabase-js";
import { uploadApi, getDevToken } from "@/lib/api-client";

export type MediaUploadMeta = {
  mediaType: "video" | "audio";
  oaId:      string;
  workId:    string;
};

/**
 * 動画/音声ファイルを直接アップロードし、保存に使う public URL を返す。
 * 失敗時は Error を throw する（呼び出し側で握って控えめにエラー表示）。
 */
export async function uploadMediaFile(file: File, meta: MediaUploadMeta): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error("アップロード設定が不足しています（Supabase の公開設定が未構成）");
  }

  // 1. 署名付きアップロード情報を取得（認証・権限・MIME・サイズ検証はサーバ側で実施）。
  const { bucket, path, token, publicUrl } = await uploadApi.requestMediaUploadUrl(getDevToken(), {
    mediaType: meta.mediaType,
    mimeType:  file.type,
    size:      file.size,
    fileName:  file.name,
    oaId:      meta.oaId,
    workId:    meta.workId,
  });

  // 2. ブラウザ → Supabase Storage へ直接アップロード（本体は Vercel route を通らない）。
  const supabase = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { error } = await supabase.storage
    .from(bucket)
    .uploadToSignedUrl(path, token, file, { contentType: file.type });
  if (error) {
    throw new Error(`アップロードに失敗しました: ${error.message}`);
  }

  // 3. 保存に使うのは恒久 public URL のみ。
  if (!/^https:\/\//i.test(publicUrl)) {
    throw new Error("アップロード結果のURLが不正です");
  }
  return publicUrl;
}
