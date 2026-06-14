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
// 環境変数: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（推奨）/ NEXT_PUBLIC_SUPABASE_ANON_KEY
// Storage バケット: image（既存 public bucket を再利用）

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { withAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/rbac";
import { getCachedOaById } from "@/lib/oa-cache";
import { ok, badRequest, notFound, serverError } from "@/lib/api-response";

const BUCKET = "image"; // 既存 public bucket を再利用（media/ 配下で画像と分離）

// mediaType ごとの許可 MIME → 保存拡張子。LINE 安定送信を考慮し mp4 / mp3 / m4a を優先（UI 側で推奨表示）。
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

// クライアント直アップロードのため Vercel body 上限に縛られない。目標上限を設定。
const VIDEO_MAX = 50 * 1024 * 1024; // 50 MB
const AUDIO_MAX = 20 * 1024 * 1024; // 20 MB

export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
                     ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey) {
      return serverError("Supabase 環境変数が設定されていません（NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）");
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

    // ── mediaType 検証（video / audio 以外は拒否） ──
    if (mediaType !== "video" && mediaType !== "audio") {
      return badRequest('mediaType は "video" または "audio" を指定してください');
    }
    // ── MIME × mediaType 整合性 ──
    const extMap = mediaType === "video" ? VIDEO_EXT : AUDIO_EXT;
    const ext = extMap[mimeType];
    if (!ext) {
      const label = mediaType === "video" ? "動画（mp4 / mov / webm）" : "音声（mp3 / m4a / wav / aac）";
      return badRequest(`対応形式は ${label} のみです（受信: "${mimeType}"）`);
    }
    // ── サイズ検証 ──
    const max = mediaType === "video" ? VIDEO_MAX : AUDIO_MAX;
    if (!Number.isFinite(size) || size <= 0) {
      return badRequest("ファイルサイズが不正です");
    }
    if (size > max) {
      return badRequest(`ファイルサイズは ${(max / 1024 / 1024).toFixed(0)} MB 以下にしてください（受信: ${(size / 1024 / 1024).toFixed(1)} MB）`);
    }

    // ── 作品存在確認 + oaId 取得（oaId はクライアント値を信用せず DB から導出） ──
    if (!workId) return badRequest("workId が必要です");
    const work = await prisma.work.findUnique({ where: { id: workId }, select: { id: true, oaId: true } });
    if (!work) return notFound("作品");

    // ── 権限確認（メッセージ作成と同等の role）。未認証/権限なしは requireRole が拒否。 ──
    const oaId = work.oaId;
    if (oaId) {
      const cachedOa = await getCachedOaById(oaId);
      if (!cachedOa) return notFound("OA");
      const check = await requireRole(oaId, user.id, "tester", { preloadedOa: { ownerKey: cachedOa.ownerKey } });
      if (!check.ok) return check.response;
    }

    // ── 安全な保存パス生成（元ファイル名は使わず uuid + 拡張子。oaId/workId は DB 値で traversal 不可） ──
    const uuid = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const path = `messages/media/${mediaType}/${oaId ?? "nooa"}/${work.id}/${uuid}.${ext}`;

    // ── signed upload URL 発行（service role）。本体はここを通らない。 ──
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      console.error("[media-upload] createSignedUploadUrl エラー:", error);
      return serverError(`アップロードURLの発行に失敗しました${error ? `: ${error.message}` : ""}`);
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = pub.publicUrl;
    if (!/^https:\/\//i.test(publicUrl)) {
      return serverError("生成された public URL が不正です");
    }

    // signedUrl 自体は保存値にしない。保存値に使うのは恒久 public URL のみ（クライアントへ明示）。
    return ok({
      bucket:    BUCKET,
      path,
      token:     data.token,
      signedUrl: data.signedUrl,
      publicUrl,
    });
  } catch (err) {
    console.error("[media-upload] 予期しないエラー:", err);
    return serverError("アップロードURLの発行に失敗しました");
  }
});
