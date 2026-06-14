// src/app/api/upload/media/route.ts
// POST /api/upload/media — 動画 / 音声ファイルを Supabase Storage にアップロードして public URL を返す。
//
// 既存の画像アップロード（/api/upload = Cloudinary, /api/upload/storage = Supabase image）には触らない。
// 画像とは保存パスを分離（messages/media/{mediaType}/...）して混在を防ぐ。
//
// 環境変数（/api/upload/storage と同じ）:
//   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（推奨）/ NEXT_PUBLIC_SUPABASE_ANON_KEY
//
// Storage バケット: image（既存の public bucket を再利用。動画/音声は media/ 配下に保存）
//
// リクエスト: multipart/form-data
//   file       — 動画 / 音声ファイル
//   mediaType  — "video" | "audio"
//   oaId       — OA ID（パス生成用）
//   workId     — 作品 ID（パス生成用）
//
// レスポンス: { success: true, data: { url: "https://..." } }
//
// サイズ上限: Vercel serverless function の request body 上限（約 4.5 MB）に収めるため 4 MB。
//   これより大きい動画/音声は、クライアント直アップロード（signed upload URL）方式が別途必要。

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { withAuth } from "@/lib/auth";
import { ok, badRequest, serverError } from "@/lib/api-response";

const BUCKET = "image"; // 既存の public bucket を再利用（media/ 配下に保存して画像と分離）

// mediaType ごとの許可 MIME と拡張子。LINE 安定送信を考慮し mp4 / mp3 / m4a を優先しつつ候補を許容。
const VIDEO_TYPES: Record<string, string> = {
  "video/mp4":        "mp4",
  "video/quicktime":  "mov",
  "video/webm":       "webm",
};
const AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg":  "mp3",
  "audio/mp3":   "mp3",
  "audio/mp4":   "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac":   "aac",
  "audio/wav":   "wav",
  "audio/x-wav": "wav",
};

// Vercel serverless の request body 上限（~4.5MB）内に収める安全側の上限。
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB（動画・音声共通）

export const POST = withAuth(async (req: NextRequest) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const activeKey   = process.env.SUPABASE_SERVICE_ROLE_KEY
                   ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !activeKey) {
    console.error("[media-upload] Supabase 環境変数が不足",
      { supabaseUrl: !!supabaseUrl, activeKey: !!activeKey });
    return serverError(
      "Supabase 環境変数が設定されていません（NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）"
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return badRequest("multipart/form-data の解析に失敗しました");
  }

  const file      = formData.get("file");
  const mediaType = (formData.get("mediaType") as string | null) ?? "";
  const oaId      = (formData.get("oaId")   as string | null) ?? "unknown";
  const workId    = (formData.get("workId") as string | null) ?? "unknown";

  // 想定外の mediaType は拒否。
  if (mediaType !== "video" && mediaType !== "audio") {
    return badRequest('mediaType は "video" または "audio" を指定してください');
  }

  if (!(file instanceof File)) {
    return badRequest("file フィールドが必要です（multipart/form-data、field name='file'）");
  }

  // mediaType と MIME の整合性チェック（動画欄に音声 / 音声欄に動画 を弾く）。
  const allowed = mediaType === "video" ? VIDEO_TYPES : AUDIO_TYPES;
  const ext = allowed[file.type];
  if (!ext) {
    const label = mediaType === "video" ? "動画（mp4 / mov / webm）" : "音声（mp3 / m4a / wav / aac）";
    return badRequest(`対応形式は ${label} のみです（受信: "${file.type}"）`);
  }

  if (file.size === 0) {
    return badRequest("ファイルが空です");
  }

  if (file.size > MAX_BYTES) {
    return badRequest(
      `ファイルサイズは ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB 以下にしてください（受信: ${(file.size / 1024 / 1024).toFixed(2)} MB）`
    );
  }

  // ファイル名は信用せず、安全な文字へ正規化 + timestamp + ランダム suffix で衝突回避。
  const baseName = file.name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 50) || "media";
  const suffix = Math.random().toString(36).slice(2, 7);
  // 画像（messages/{oaId}/...）と分離するため media/{mediaType}/ を挟む。
  const path = `messages/media/${mediaType}/${oaId}/${workId}/${Date.now()}-${suffix}-${baseName}.${ext}`;

  const supabase = createClient(supabaseUrl, activeKey, { auth: { persistSession: false } });
  const arrayBuffer = await file.arrayBuffer();

  console.log(`[media-upload] アップロード開始 path=${path} size=${file.size} type=${file.type}`);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, arrayBuffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    console.error("[media-upload] Supabase Storage エラー:", uploadError);
    return serverError(`アップロードに失敗しました: ${uploadError.message}`);
  }

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path);
  console.log(`[media-upload] 成功 url=${publicUrl}`);

  return ok({ url: publicUrl });
});
