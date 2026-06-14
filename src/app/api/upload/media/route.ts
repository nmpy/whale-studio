// src/app/api/upload/media/route.ts
// POST /api/upload/media — 動画 / 音声アップロード用の Supabase signed upload URL を発行する。
//
// このルートは「ファイル本体を受け取らない」。メタ情報（mediaType / mimeType / size / fileName / workId）を
// 受け取り、認証・権限・MIME・サイズを検証したうえで、署名付きアップロードURL（token）と保存先 path、
// 保存後に使う public URL を返す。クライアントは受け取った token で Supabase Storage に直接アップロードする
// （= Vercel serverless の request body 上限 ~4.5MB を回避し、大容量の動画/音声を扱える）。
//
// 既存の画像アップロード（/api/upload = Cloudinary, /api/upload/storage）には一切触らない。
// 画像とは保存パス（messages/media/{mediaType}/...）で分離する。
//
// 署名付きアップロードURLの発行は service role key が必要（anon key では発行できないことがある）。
// 失敗理由はクライアントへ「秘匿情報を含まない範囲で」具体的に返し、原因切り分けを可能にする。
//
// 環境変数: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（必須）
// Storage バケット: image（既存 public bucket を再利用）

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { withAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { getCachedOaById } from "@/lib/oa-cache";
import { ok, badRequest, notFound } from "@/lib/api-response";

const BUCKET = "image"; // 既存 public bucket を再利用（media/ 配下で画像と分離）

const VIDEO_EXT: Record<string, string> = {
  "video/mp4":       "mp4",
  "video/quicktime": "mov",
  "video/webm":      "webm",
};
const AUDIO_EXT: Record<string, string> = {
  "audio/mpeg":  "mp3",
  "audio/mp3":   "mp3",
  "audio/mp4":   "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac":   "aac",
  "audio/wav":   "wav",
  "audio/x-wav": "wav",
};

const VIDEO_MAX = 50 * 1024 * 1024; // 50 MB
const AUDIO_MAX = 20 * 1024 * 1024; // 20 MB

// 具体的だが秘匿情報を含まない 5xx を返す（serverError は文言を一律 generic 化するため使わない）。
function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    // 署名付きアップロードURLの発行には service role が必要（anon では失敗しうる）。
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl) {
      return fail(500, "STORAGE_CONFIG", "ストレージ設定が未構成です（NEXT_PUBLIC_SUPABASE_URL 未設定）");
    }
    if (!serviceKey) {
      // 秘匿値は出さない。どの env が必要かだけを伝える。
      return fail(500, "STORAGE_CONFIG", "ストレージ管理キー（SUPABASE_SERVICE_ROLE_KEY）が未設定のため、アップロードURLを発行できません");
    }

    let body: { mediaType?: unknown; mimeType?: unknown; size?: unknown; fileName?: unknown; workId?: unknown };
    try {
      body = await req.json();
    } catch {
      return badRequest("リクエストボディ（JSON）の解析に失敗しました");
    }

    const mediaType = body.mediaType;
    const mimeType  = typeof body.mimeType === "string" ? body.mimeType : "";
    const size      = typeof body.size === "number" ? body.size : NaN;
    const workId    = typeof body.workId === "string" ? body.workId : "";

    if (mediaType !== "video" && mediaType !== "audio") {
      return badRequest('mediaType は "video" または "audio" を指定してください');
    }
    const extMap = mediaType === "video" ? VIDEO_EXT : AUDIO_EXT;
    const ext = extMap[mimeType];
    if (!ext) {
      const label = mediaType === "video" ? "動画（mp4 / mov / webm）" : "音声（mp3 / m4a / wav / aac）";
      return badRequest(`対応していないファイル形式です。${label}を選択してください（受信: "${mimeType}"）`);
    }
    const max = mediaType === "video" ? VIDEO_MAX : AUDIO_MAX;
    if (!Number.isFinite(size) || size <= 0) {
      return badRequest("ファイルサイズが不正です");
    }
    if (size > max) {
      return badRequest(`ファイルサイズが上限（${(max / 1024 / 1024).toFixed(0)} MB）を超えています（受信: ${(size / 1024 / 1024).toFixed(1)} MB）`);
    }

    if (!workId) return badRequest("workId が必要です");
    const work = await prisma.work.findUnique({ where: { id: workId }, select: { id: true, oaId: true } });
    if (!work) return notFound("作品");

    // 権限確認（メッセージ作成と同等の role）。requireRole は未認証/権限なしを 401/403 で返す。
    const oaId = work.oaId;
    if (oaId) {
      const cachedOa = await getCachedOaById(oaId);
      if (!cachedOa) return notFound("OA");
      const check = await requireRole(oaId, user.id, "tester", { preloadedOa: { ownerKey: cachedOa.ownerKey } });
      if (!check.ok) return check.response;
    }

    // 安全な保存パス（元ファイル名は使わず uuid + 拡張子。oaId/workId は DB 値で traversal 不可）。
    const uuid = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const path = `messages/media/${mediaType}/${oaId ?? "nooa"}/${work.id}/${uuid}.${ext}`;

    // signed upload URL 発行（service role）。本体はここを通らない。
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    let data: { signedUrl: string; token: string; path: string } | null = null;
    try {
      const res = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
      if (res.error) {
        // Supabase の storage エラーメッセージは秘匿情報を含まない（例: "Bucket not found"）。原因切り分けのため返す。
        console.error("[media-upload] createSignedUploadUrl error:", res.error);
        // RLS / 権限系のときは、運用者が原因に気づけるよう（秘匿情報を出さずに）ヒントを添える。
        const permissionIssue = /row-level security|not authorized|permission|forbidden|jwt/i.test(res.error.message);
        const hint = permissionIssue
          ? "（サーバーのストレージ権限が不足しています。SUPABASE_SERVICE_ROLE_KEY が対象プロジェクトの service_role キーか、または image バケットの Storage ポリシーをご確認ください）"
          : "";
        return fail(502, "STORAGE_SIGN_FAILED", `アップロードURLの発行に失敗しました（ストレージ: ${res.error.message}）${hint}`);
      }
      data = res.data;
    } catch (e) {
      console.error("[media-upload] createSignedUploadUrl threw:", e);
      return fail(502, "STORAGE_SIGN_FAILED", `アップロードURLの発行に失敗しました（${e instanceof Error ? e.message : "unknown"}）`);
    }
    if (!data?.token) {
      return fail(502, "STORAGE_SIGN_FAILED", "アップロードURLの発行に失敗しました（token が取得できませんでした）");
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = pub.publicUrl;
    if (!/^https:\/\//i.test(publicUrl)) {
      return fail(500, "STORAGE_URL_INVALID", "生成された public URL が不正です（ストレージ設定をご確認ください）");
    }

    // signedUrl 自体は保存値にしない。保存値に使うのは恒久 public URL のみ。
    return ok({ bucket: BUCKET, path, token: data.token, signedUrl: data.signedUrl, publicUrl });
  } catch (err) {
    // 秘匿情報を含まない範囲で原因を返す（service role key 等は error.message に含まれない）。
    console.error("[media-upload] unexpected error:", err);
    return fail(500, "MEDIA_UPLOAD_ERROR", `アップロードURLの発行に失敗しました（${err instanceof Error ? err.message : "unknown"}）`);
  }
});
