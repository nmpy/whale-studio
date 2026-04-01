// src/app/api/upload/route.ts
// POST /api/upload — 画像ファイルを Cloudinary にアップロードして URL を返す
//
// 環境変数（Vercel に設定すること）:
//   CLOUDINARY_CLOUD_NAME  — Cloudinary クラウド名
//   CLOUDINARY_API_KEY     — API キー
//   CLOUDINARY_API_SECRET  — API シークレット
//   または CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud_name>
//
// リクエスト: multipart/form-data  field name = "file"
// レスポンス: { success: true, data: { url: "https://res.cloudinary.com/..." } }

import { NextRequest } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import { withAuth } from "@/lib/auth";
import { ok, badRequest, serverError } from "@/lib/api-response";

// 許可する MIME タイプ
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
// 最大ファイルサイズ: 5 MB
const MAX_BYTES = 5 * 1024 * 1024;

// Cloudinary 設定（CLOUDINARY_URL があればそちら優先）
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

export const POST = withAuth(async (req: NextRequest) => {
  // ── 環境変数チェック ──
  const cloudName  = process.env.CLOUDINARY_CLOUD_NAME  ?? (process.env.CLOUDINARY_URL ? "via_url" : undefined);
  const apiKey     = process.env.CLOUDINARY_API_KEY     ?? (process.env.CLOUDINARY_URL ? "via_url" : undefined);
  const apiSecret  = process.env.CLOUDINARY_API_SECRET  ?? (process.env.CLOUDINARY_URL ? "via_url" : undefined);
  const hasCloudinaryUrl = !!process.env.CLOUDINARY_URL;

  console.log(
    "[upload] Cloudinary 設定確認",
    `CLOUDINARY_URL=${hasCloudinaryUrl ? "あり" : "なし"}`,
    `CLOUD_NAME=${cloudName ? "あり" : "❌ 未設定"}`,
    `API_KEY=${apiKey ? "あり" : "❌ 未設定"}`,
    `API_SECRET=${apiSecret ? "あり" : "❌ 未設定"}`
  );

  if (!cloudName || !apiKey || !apiSecret) {
    console.error("[upload] Cloudinary 環境変数が不足しています");
    return serverError("Cloudinary 環境変数が設定されていません（CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET）");
  }

  try {
    // ── formData からファイル取得 ──
    const formData = await req.formData();
    const file = formData.get("file");

    console.log(
      "[upload] file フィールド確認",
      `type=${typeof file}`,
      file instanceof File
        ? `name="${file.name}" mimeType="${file.type}" size=${file.size}bytes`
        : `value=${String(file)}`
    );

    if (!(file instanceof File)) {
      return badRequest("file フィールドが見つかりません（multipart/form-data で field name='file' を送ってください）");
    }

    // ── バリデーション ──
    if (!ALLOWED_TYPES.includes(file.type)) {
      return badRequest(`対応形式は JPEG / PNG / WebP / GIF のみです（受信: "${file.type}"）`);
    }
    if (file.size === 0) {
      return badRequest("ファイルが空です");
    }
    if (file.size > MAX_BYTES) {
      return badRequest(`ファイルサイズは 5 MB 以下にしてください（受信: ${(file.size / 1024 / 1024).toFixed(2)} MB）`);
    }

    // ── ArrayBuffer → Base64 Data URI に変換して Cloudinary へ ──
    const arrayBuffer = await file.arrayBuffer();
    const base64      = Buffer.from(arrayBuffer).toString("base64");
    const dataUri     = `data:${file.type};base64,${base64}`;

    console.log(`[upload] Cloudinary アップロード開始 size=${file.size}bytes mimeType=${file.type}`);

    const result = await cloudinary.uploader.upload(dataUri, {
      folder:         "whale-studio",
      resource_type:  "image",
      // 元ファイル名をパブリック ID のベース名に使う（コリジョン回避のため timestamp 付き）
      public_id:      `${Date.now()}-${file.name.replace(/\.[^.]+$/, "").slice(0, 40)}`,
      overwrite:      false,
    });

    console.log(`[upload] Cloudinary アップロード成功 url=${result.secure_url} publicId=${result.public_id}`);

    return ok({ url: result.secure_url });

  } catch (err) {
    const e = err as { message?: string; http_code?: number; error?: { message: string } } | null;
    console.error("[upload] アップロードエラー", {
      message:   e?.message,
      http_code: e?.http_code,
      error:     e?.error,
      raw:       String(err),
    });
    return serverError(err);
  }
});
