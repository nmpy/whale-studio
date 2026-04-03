// src/app/api/upload/storage/route.ts
// POST /api/upload/storage — 画像ファイルを Supabase Storage にアップロードして public URL を返す
//
// 環境変数:
//   NEXT_PUBLIC_SUPABASE_URL       — Supabase プロジェクト URL
//   SUPABASE_SERVICE_ROLE_KEY      — サービスロールキー（RLS バイパス。推奨）
//   NEXT_PUBLIC_SUPABASE_ANON_KEY  — 匿名キー（サービスロールキー未設定時のフォールバック）
//
// Storage バケット: image（public bucket）
// 保存パス: messages/{oaId}/{workId}/{timestamp}-{safeName}
//
// リクエスト: multipart/form-data
//   file   — 画像ファイル（JPEG / PNG / WebP、最大 5 MB）
//   oaId   — OA ID（パス生成用）
//   workId — 作品 ID（パス生成用）
//
// レスポンス: { success: true, data: { url: "https://..." } }

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { withAuth } from "@/lib/auth";
import { ok, badRequest, serverError } from "@/lib/api-response";

const BUCKET    = "image";
const ALLOWED   = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const POST = withAuth(async (req: NextRequest) => {
  // ── 環境変数チェック ──────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Service role key は RLS をバイパスできる（サーバー専用）。
  // 未設定なら anon key にフォールバックするが、その場合は Storage policy 設定が必要。
  const activeKey   = process.env.SUPABASE_SERVICE_ROLE_KEY
                   ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !activeKey) {
    console.error("[storage-upload] Supabase 環境変数が不足",
      { supabaseUrl: !!supabaseUrl, activeKey: !!activeKey });
    return serverError(
      "Supabase 環境変数が設定されていません（NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）"
    );
  }

  const supabase = createClient(supabaseUrl, activeKey, {
    auth: { persistSession: false },
  });

  // ── フォームデータ取得 ──────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return badRequest("multipart/form-data の解析に失敗しました");
  }

  const file   = formData.get("file");
  const oaId   = (formData.get("oaId")   as string | null) ?? "unknown";
  const workId = (formData.get("workId") as string | null) ?? "unknown";

  // ── バリデーション ──────────────────────────────────────────
  if (!(file instanceof File)) {
    return badRequest("file フィールドが必要です（multipart/form-data、field name='file'）");
  }

  if (!ALLOWED.includes(file.type)) {
    return badRequest(
      `対応形式は JPEG / PNG / WebP のみです（受信: "${file.type}"）`
    );
  }

  if (file.size === 0) {
    return badRequest("ファイルが空です");
  }

  if (file.size > MAX_BYTES) {
    return badRequest(
      `ファイルサイズは 5 MB 以下にしてください（受信: ${(file.size / 1024 / 1024).toFixed(2)} MB）`
    );
  }

  // ── 保存パス生成（衝突回避のため timestamp + ランダム suffix） ──
  const ext      = file.type === "image/png" ? "png"
                 : file.type === "image/webp" ? "webp"
                 : "jpg";
  const baseName = file.name
    .replace(/\.[^.]+$/, "")                 // 拡張子を除去
    .replace(/[^a-zA-Z0-9._-]/g, "_")        // 特殊文字をアンダースコアに
    .slice(0, 50);                            // 長すぎるファイル名を切り詰め
  const suffix = Math.random().toString(36).slice(2, 7);
  const path   = `messages/${oaId}/${workId}/${Date.now()}-${suffix}-${baseName}.${ext}`;

  // ── Supabase Storage へアップロード ────────────────────────
  const arrayBuffer = await file.arrayBuffer();

  console.log(`[storage-upload] アップロード開始 path=${path} size=${file.size} type=${file.type}`);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, arrayBuffer, {
      contentType: file.type,
      upsert:      false,
    });

  if (uploadError) {
    console.error("[storage-upload] Supabase Storage エラー:", uploadError);
    return serverError(`Storage アップロードに失敗しました: ${uploadError.message}`);
  }

  // ── public URL 取得 ────────────────────────────────────────
  const { data: { publicUrl } } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(path);

  console.log(`[storage-upload] 成功 url=${publicUrl}`);

  return ok({ url: publicUrl });
});
