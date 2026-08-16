// src/app/api/oas/:id/broadcasts/upload-image/route.ts
// POST — 配信メッセージ用の画像アップロード。editor 以上。**配信専用**。
//
// なぜ既存 /api/upload を使わないか:
//   既存 /api/upload は応答メッセージのフォームが使っている共有経路で、
//   (a) OA スコープを持たない、(b) WebP / GIF も許可する、(c) LINE の
//   original 10MB / preview 1MB という制約を知らない。配信用にそれを直すと
//   応答メッセージ側の挙動を変えてしまうため、既存経路には一切手を触れず、
//   **同じ Cloudinary 資産（既存の依存・既存の環境変数）を使う配信専用経路**を足す。
//   新しい storage provider は導入しない。
//
// LINE 仕様（公式リファレンス）に合わせた制約:
//   - image message の originalContentUrl / previewImageUrl は HTTPS (TLS 1.2+)
//   - 画像形式は JPEG または PNG のみ
//   - originalContentUrl は最大 10MB、previewImageUrl は最大 1MB
//   preview は Cloudinary の変換 URL で生成するため、常に小さい JPEG になる。
//
// アップロード上限について:
//   この経路は multipart を Vercel Function が受けて Cloudinary へ中継するため、
//   **Vercel の request body 上限 4.5MB** が先に効く。よって Whale Studio 経由の
//   アップロードは 4MB までとする（upload-limits.ts）。LINE 仕様の 10MB を使いたい
//   場合は、公開済みの HTTPS URL を直接指定する経路を使う。

import { NextRequest } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import { withRole } from "@/lib/auth";
import { ok, badRequest, serverError } from "@/lib/api-response";
import { BROADCAST_EDIT_ROLE } from "../_shared";
import {
  BROADCAST_UPLOAD_MAX_BYTES, BROADCAST_UPLOAD_ALLOWED_TYPES, BROADCAST_UPLOAD_MAX_LABEL,
} from "@/lib/broadcast/upload-limits";

export const dynamic = "force-dynamic";

// 許可形式・サイズ上限は upload-limits.ts に一元化（UI と server で乖離させない）。
const ALLOWED_TYPES: readonly string[] = BROADCAST_UPLOAD_ALLOWED_TYPES;

/**
 * preview 用の Cloudinary 変換。
 * 長辺 240px に収め（拡大はしない）JPEG へ変換するので、LINE の preview 1MB 上限を確実に下回る。
 */
const PREVIEW_TRANSFORM = "w_240,h_240,c_limit,q_auto,f_jpg";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

/** Cloudinary の secure_url に変換を差し込んで preview URL を作る。 */
function toPreviewUrl(secureUrl: string): string | null {
  const marker = "/image/upload/";
  const i = secureUrl.indexOf(marker);
  if (i === -1) return null;
  return `${secureUrl.slice(0, i + marker.length)}${PREVIEW_TRANSFORM}/${secureUrl.slice(i + marker.length)}`;
}

export const POST = withRole<{ id: string }>(
  ({ params }) => params.id,
  BROADCAST_EDIT_ROLE,
  async (req: NextRequest, { params }) => {
    const configured =
      (!!process.env.CLOUDINARY_CLOUD_NAME && !!process.env.CLOUDINARY_API_KEY && !!process.env.CLOUDINARY_API_SECRET) ||
      !!process.env.CLOUDINARY_URL;
    if (!configured) {
      // 秘密値は出さず、設定不足であることだけを伝える
      return serverError("画像アップロードの設定が未完了です");
    }

    try {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return badRequest("file フィールドが見つかりません");
      }
      if (!ALLOWED_TYPES.includes(file.type)) {
        return badRequest("LINE の画像メッセージで使えるのは JPEG / PNG のみです");
      }
      if (file.size === 0) return badRequest("ファイルが空です");
      if (file.size > BROADCAST_UPLOAD_MAX_BYTES) {
        // Vercel Functions の request body 上限（4.5MB）より内側に収める。
        return badRequest(
          `アップロードできる画像は ${BROADCAST_UPLOAD_MAX_LABEL} 以下です（受信: ${(file.size / 1024 / 1024).toFixed(2)} MB）。` +
          `より大きい画像は、公開済みの HTTPS URL を直接指定してください。`,
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const dataUri = `data:${file.type};base64,${Buffer.from(arrayBuffer).toString("base64")}`;

      const result = await cloudinary.uploader.upload(dataUri, {
        // OA ごとにフォルダを分ける（配信素材が OA をまたいで混ざらないようにする）
        folder:        `whale-studio/broadcasts/${params.id}`,
        resource_type: "image",
        // クライアント由来のファイル名は信用しない（パス片・拡張子偽装を持ち込ませない）。
        // public_id はサーバー側で生成する。
        public_id:     `bc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        overwrite:     false,
      });

      const originalContentUrl = result.secure_url;
      const previewImageUrl = toPreviewUrl(originalContentUrl);
      if (!originalContentUrl?.startsWith("https://") || !previewImageUrl) {
        return serverError("アップロード結果の URL を取得できませんでした");
      }

      console.log("[line:broadcast:upload-image]", JSON.stringify({
        oaId: params.id, bytes: file.size, mime: file.type,
      }));

      return ok({ original_content_url: originalContentUrl, preview_image_url: previewImageUrl });
    } catch (err) {
      console.error("[line:broadcast:upload-image:failed]", String(err));
      return serverError(err);
    }
  },
);
