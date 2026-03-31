// src/app/api/upload/route.ts
// POST /api/upload — 画像ファイルをサーバーに保存して URL を返す
//
// ローカル開発: public/uploads/ に保存 → /uploads/<filename> で配信
// 本番移行時:  このルートを S3 / Supabase Storage 等に差し替える
//
// リクエスト: multipart/form-data  field name = "file"
// レスポンス: { success: true, data: { url: "/uploads/<filename>" } }

import { NextRequest } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { withAuth } from "@/lib/auth";
import { ok, badRequest, serverError } from "@/lib/api-response";

// 許可する MIME タイプ
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
// 最大ファイルサイズ: 5 MB
const MAX_BYTES = 5 * 1024 * 1024;

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    console.log("[upload] file field type:", typeof file, file instanceof File ? `name=${file.name} type=${file.type} size=${file.size}` : String(file));

    if (!(file instanceof File)) {
      return badRequest("file フィールドが見つかりません");
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return badRequest(`対応形式は JPEG / PNG / WebP / GIF のみです（受信: ${file.type}）`);
    }
    if (file.size > MAX_BYTES) {
      return badRequest("ファイルサイズは 5 MB 以下にしてください");
    }

    // 衝突を防ぐためタイムスタンプ + ランダム値でファイル名生成
    const ext      = file.name.split(".").pop()?.toLowerCase() ?? "bin";
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    const filepath  = path.join(uploadDir, filename);

    await mkdir(uploadDir, { recursive: true });
    await writeFile(filepath, Buffer.from(await file.arrayBuffer()));

    return ok({ url: `/uploads/${filename}` });
  } catch (err) {
    console.error("[upload] UNEXPECTED ERROR:", err);
    return serverError(err);
  }
});
