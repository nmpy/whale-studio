// src/app/api/media/probe/route.ts
// POST /api/media/probe — 外部URLメディアの Content-Length / Content-Type を HEAD で取得する。
//
// 目的: 外部URL参照方式で、動画/サムネのサイズ・種別を「本体を中継せず」に把握するため。
//   - 基本は HEAD リクエスト（レスポンスボディを受け取らない）。
//   - HEAD 非対応 / Content-Length 不明のときは sizeKnown=false を返す（取得不可として明示）。
//   - 本体を Vercel/Next.js 側に取り込まない（= 大容量ファイルの中継をしない）。
//
// SSRF 抑止: https のみ許可し、localhost / プライベート IP リテラルを拒否する（認証必須の CMS 用途）。
// これは完全な SSRF 対策ではない（DNS リバインディング等は防げない）ため、将来必要なら allowlist を検討。

import { withAuth } from "@/lib/auth";
import { ok, badRequest } from "@/lib/api-response";
import { URL_MAX_LENGTH } from "@/lib/media-validation";

export const dynamic = "force-dynamic";

// プライベート/ループバックのホスト名・IP リテラルを拒否する簡易ガード。
function isDisallowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // IPv6 ループバック
  if (h === "::1" || h === "[::1]") return true;
  // IPv4 プライベート / ループバック / リンクローカル / メタデータ
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // link-local（クラウドのメタデータ 169.254.169.254 を含む）
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true; // 172.16.0.0/12
  if (h === "0.0.0.0") return true;
  return false;
}

export const POST = withAuth(async (req) => {
  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return badRequest("リクエストボディ（JSON）の解析に失敗しました");
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) return badRequest("url が必要です");
  if (url.length > URL_MAX_LENGTH) return badRequest(`URL は ${URL_MAX_LENGTH} 文字以内にしてください`);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return badRequest("URL の形式が不正です");
  }
  if (parsed.protocol !== "https:") return badRequest("https の URL のみ対応しています");
  if (isDisallowedHost(parsed.hostname)) return badRequest("このホストの URL は指定できません");

  // HEAD で Content-Length / Content-Type を取得（本体は受け取らない）。タイムアウトを付ける。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(parsed.toString(), {
      method:   "HEAD",
      redirect: "follow",
      signal:   controller.signal,
    });

    const contentType   = res.headers.get("content-type");
    const contentLength  = res.headers.get("content-length");
    const parsedLength   = contentLength != null && /^\d+$/.test(contentLength) ? Number(contentLength) : null;
    // Number にしても safe integer 内（現実的なファイルサイズ）。念のため safe 範囲外は string で返す。
    const sizeBytes: number | string | null =
      parsedLength == null ? null
      : Number.isSafeInteger(parsedLength) ? parsedLength
      : String(contentLength);

    return ok({
      // reachable=true でも Content-Length が無ければ sizeKnown=false（HEAD 非対応 CDN 等）。
      reachable:   res.ok,
      status:      res.status,
      contentType: contentType ?? null,
      // MIME の base（"video/mp4; charset=..." → "video/mp4"）
      mimeType:    contentType ? contentType.split(";")[0].trim() : null,
      sizeKnown:   parsedLength != null,
      sizeBytes,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    // 取得不可でも保存全体は落とさない。「サイズ不明」としてクライアントが扱えるよう 200 で返す。
    return ok({
      reachable:   false,
      status:      null,
      contentType: null,
      mimeType:    null,
      sizeKnown:   false,
      sizeBytes:   null,
      error:       aborted ? "timeout" : "fetch_failed",
    });
  } finally {
    clearTimeout(timer);
  }
});
