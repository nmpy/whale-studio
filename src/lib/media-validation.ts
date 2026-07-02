// src/lib/media-validation.ts
// 外部URL参照メディアの「用途別」バリデーション。
// サーバ側（メッセージ保存 API の superRefine）を真実の源とし、フロント（CMS）の即時警告でも同じ関数を使う。
//
// 扱うのは URL とメタ情報のみ（バイナリ本体は一切扱わない）。
//
// 用途 (asset_usage):
//   - line_video    : LINE トークに動画メッセージとして送る。mp4 / https / ≤200MB /
//                     previewImageUrl 必須（JPEG/PNG・≤1MB）/ URL ≤2000 文字。
//   - liff_playback : LIFF ページ内で再生。200MB 超も許容（ただし LINE video としては送らない）。
//                     通信環境の警告を出す。
//   - cms_preview   : CMS 内プレビューのみ。LINE 制約は課さない。
//
// このバリデーションは「外部URL参照 (asset_media_source = external_url)」にのみ適用する。
// 通常アップロード (upload / null) は既存の容量制限のままで、ここでは追加制約を課さない。

export const URL_MAX_LENGTH = 2000;
export const LINE_VIDEO_MAX_BYTES = 200 * 1024 * 1024; // 200 MB
export const LINE_IMAGE_MAX_BYTES = 10 * 1024 * 1024; //  10 MB
export const LINE_VIDEO_PREVIEW_MAX_BYTES = 1 * 1024 * 1024; // 1 MB

export type MediaUsage = "line_video" | "liff_playback" | "cms_preview";
export const MEDIA_USAGES: readonly MediaUsage[] = ["line_video", "liff_playback", "cms_preview"] as const;

export type MediaSource = "upload" | "external_url";
export const MEDIA_SOURCES: readonly MediaSource[] = ["upload", "external_url"] as const;

export type MediaValidationField = "content_url" | "preview_url" | "size" | "usage" | "mime";

export type MediaValidationIssue = {
  level:   "error" | "warning";
  code:    string;
  field:   MediaValidationField;
  message: string;
};

export type MediaValidationInput = {
  /** "video" | "image"。message_type から決める。 */
  mediaKind:        "video" | "image";
  usage?:           MediaUsage | null;
  /** 動画/画像本体の URL。 */
  contentUrl?:      string | null;
  /** 本体の MIME（例: "video/mp4"）。null/undefined = 不明。 */
  contentMimeType?: string | null;
  /** 本体のサイズ(bytes)。null/undefined = 不明（= サイズ検証は警告扱い）。 */
  contentSizeBytes?: number | null;
  /** サムネイル画像 URL（動画用途）。 */
  previewUrl?:      string | null;
  /** サムネイルの MIME。null/undefined = 不明。 */
  previewMimeType?: string | null;
  /** サムネイルのサイズ(bytes)。null/undefined = 不明。 */
  previewSizeBytes?: number | null;
};

const isHttps       = (u: string) => /^https:\/\//i.test(u.trim());
const isMp4Mime     = (m?: string | null) => !!m && /^video\/mp4$/i.test(m.trim());
const isImageMime   = (m?: string | null) => !!m && /^image\/(jpe?g|png)$/i.test(m.trim());
const looksMp4Url   = (u: string) => /\.mp4(\?|#|$)/i.test(u.trim());
const looksImageUrl = (u: string) => /\.(jpe?g|png)(\?|#|$)/i.test(u.trim());

/** URL の共通チェック（https + 長さ）。ラベルはエラーメッセージ用（"動画" / "画像" / "サムネイル"）。 */
function checkUrl(url: string, field: MediaValidationField, label: string): MediaValidationIssue[] {
  const issues: MediaValidationIssue[] = [];
  if (!isHttps(url)) {
    issues.push({ level: "error", code: `${field}_not_https`, field, message: `${label} URL は https で指定してください` });
  }
  if (url.length > URL_MAX_LENGTH) {
    issues.push({ level: "error", code: `${field}_too_long`, field, message: `${label} URL は ${URL_MAX_LENGTH} 文字以内にしてください` });
  }
  return issues;
}

/**
 * 用途別にメディアを検証し、問題（error / warning）の配列を返す。
 * error が 1 件でもあれば保存/送信をブロックする（hasBlockingError で判定）。
 * warning は保存を止めない（フロントで注意喚起する）。
 */
export function validateMedia(input: MediaValidationInput): MediaValidationIssue[] {
  const issues: MediaValidationIssue[] = [];
  const usage = input.usage ?? null;
  const url   = (input.contentUrl ?? "").trim();

  if (input.mediaKind === "video") {
    if (!url) {
      issues.push({ level: "error", code: "content_url_required", field: "content_url", message: "動画 URL は必須です" });
    } else {
      issues.push(...checkUrl(url, "content_url", "動画"));
    }

    if (usage === "line_video") {
      // mp4 判定: MIME があれば厳格、無ければ URL 拡張子で推定し不明なら警告。
      if (input.contentMimeType) {
        if (!isMp4Mime(input.contentMimeType)) {
          issues.push({ level: "error", code: "video_not_mp4", field: "mime", message: "LINE 動画メッセージは mp4 のみ対応です" });
        }
      } else if (url && !looksMp4Url(url)) {
        issues.push({ level: "warning", code: "video_mp4_unverified", field: "mime", message: "mp4 か判定できません。LINE 動画メッセージは mp4 のみ送信できます" });
      }

      // サイズ: 既知で 200MB 超はエラー。不明は警告（送信前に超過の可能性を明示）。
      if (input.contentSizeBytes == null) {
        issues.push({ level: "warning", code: "video_size_unknown", field: "size", message: "動画サイズが不明です。LINE 動画メッセージは 200MB を超えると送信できません" });
      } else if (input.contentSizeBytes > LINE_VIDEO_MAX_BYTES) {
        issues.push({ level: "error", code: "video_too_large", field: "size", message: "LINE 動画メッセージは 200MB 以下にしてください" });
      }

      // previewImageUrl 必須（mp4 の流用禁止 = 専用サムネが要る）。
      const preview = (input.previewUrl ?? "").trim();
      if (!preview) {
        issues.push({ level: "error", code: "preview_required", field: "preview_url", message: "LINE 動画メッセージにはサムネイル画像 URL（JPEG/PNG）が必須です" });
      } else {
        issues.push(...checkUrl(preview, "preview_url", "サムネイル"));
        if (input.previewMimeType) {
          if (!isImageMime(input.previewMimeType)) {
            issues.push({ level: "error", code: "preview_not_image", field: "preview_url", message: "サムネイルは JPEG / PNG のみ対応です" });
          }
        } else if (!looksImageUrl(preview)) {
          issues.push({ level: "warning", code: "preview_image_unverified", field: "preview_url", message: "サムネイルが JPEG/PNG か判定できません" });
        }
        if (input.previewSizeBytes != null && input.previewSizeBytes > LINE_VIDEO_PREVIEW_MAX_BYTES) {
          issues.push({ level: "error", code: "preview_too_large", field: "preview_url", message: "サムネイル画像は 1MB 以下にしてください" });
        }
      }
    } else if (usage === "liff_playback") {
      // 200MB 超も許容。ただし通信環境の警告を出す。LINE video としては送らない（送信側 line.ts が判定）。
      if (input.contentSizeBytes != null && input.contentSizeBytes > LINE_VIDEO_MAX_BYTES) {
        issues.push({ level: "warning", code: "liff_large_video", field: "size", message: "200MB を超える動画です。通信環境によっては再生に時間がかかる可能性があります（LINE 動画メッセージとしては送信されません）" });
      }
    }
    // usage が null / cms_preview のときは追加制約なし（保存は許可。送信時にサムネ有無で判定）。
  }

  if (input.mediaKind === "image") {
    if (!url) {
      issues.push({ level: "error", code: "content_url_required", field: "content_url", message: "画像 URL は必須です" });
    } else {
      issues.push(...checkUrl(url, "content_url", "画像"));
    }
    // LINE 画像メッセージ用途（liff_playback / cms_preview 以外）は JPEG/PNG・10MB を課す。
    if (usage !== "liff_playback" && usage !== "cms_preview") {
      if (input.contentMimeType) {
        if (!isImageMime(input.contentMimeType)) {
          issues.push({ level: "error", code: "image_not_supported", field: "mime", message: "LINE 画像メッセージは JPEG / PNG のみ対応です" });
        }
      } else if (url && !looksImageUrl(url)) {
        issues.push({ level: "warning", code: "image_type_unverified", field: "mime", message: "JPEG/PNG か判定できません。LINE 画像メッセージは JPEG / PNG のみ送信できます" });
      }
      if (input.contentSizeBytes == null) {
        issues.push({ level: "warning", code: "image_size_unknown", field: "size", message: "画像サイズが不明です。LINE 画像メッセージは 10MB を超えると送信できません" });
      } else if (input.contentSizeBytes > LINE_IMAGE_MAX_BYTES) {
        issues.push({ level: "error", code: "image_too_large", field: "size", message: "LINE 画像メッセージは 10MB 以下にしてください" });
      }
    }
  }

  return issues;
}

/** error レベルの問題が 1 件でもあれば true（= 保存/送信をブロックすべき）。 */
export function hasBlockingError(issues: MediaValidationIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}

/**
 * Prisma の BigInt を JSON レスポンス/フォーム初期値用に変換する。
 * safe integer 範囲内なら number、それを超えるなら string を返す（BigInt をそのまま JSON.stringify しない）。
 */
export function bigintToJson(v: bigint | number | null | undefined): number | string | null {
  if (v == null) return null;
  const n = typeof v === "bigint" ? v : BigInt(Math.trunc(v));
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const min = BigInt(Number.MIN_SAFE_INTEGER);
  return n <= max && n >= min ? Number(n) : n.toString();
}

/** 数値/文字列/BigInt を Prisma BigInt 列へ書き込む形（bigint | null）に正規化する。負数・非有限は null。 */
export function toBigIntOrNull(v: number | string | bigint | null | undefined): bigint | null {
  if (v == null) return null;
  try {
    if (typeof v === "bigint") return v >= BigInt(0) ? v : null;
    if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? BigInt(Math.trunc(v)) : null;
    const s = v.trim();
    if (!/^\d+$/.test(s)) return null;
    return BigInt(s);
  } catch {
    return null;
  }
}
