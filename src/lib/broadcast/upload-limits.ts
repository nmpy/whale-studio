// src/lib/broadcast/upload-limits.ts
//
// 配信メッセージの画像アップロード上限。**server と client の両方から import する。**
// 片方だけ書き換えて上限が乖離することを防ぐため、数値はここにしか置かない。

/**
 * Whale Studio 経由でアップロードできる画像の上限。
 *
 * Production は Vercel Functions 上で動いており、**request body の上限は 4.5MB**。
 * 現在の実装は multipart を route handler が受けて Cloudinary へ中継する
 * server-proxy 方式なので、4.5MB を超えるファイルは route handler に届く前に
 * 413 (FUNCTION_PAYLOAD_TOO_LARGE) になる。余裕を見て 4MB を上限とする。
 *
 * これは **LINE の image message の上限を 4MB にするという意味ではない**。
 * 既に HTTPS 上にある画像を URL で直接指定する場合は、従来どおり LINE 仕様
 * （original 10MB / preview 1MB）の範囲で使える。制限がかかるのは
 * 「Whale Studio 経由でアップロードする」経路だけ。
 *
 * より大きい画像を CMS からアップロードしたくなった場合は、
 * Cloudinary の signed client-side upload（ブラウザから直接アップロード）を
 * 別 PR で検討する。本 PR では実装しない。
 */
export const BROADCAST_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** LINE の image message が受け付ける形式のみ。WebP / GIF は不可。 */
export const BROADCAST_UPLOAD_ALLOWED_TYPES = ["image/jpeg", "image/png"] as const;

/** UI とエラーメッセージで共用する表記（"4MB"）。 */
export const BROADCAST_UPLOAD_MAX_LABEL = `${BROADCAST_UPLOAD_MAX_BYTES / 1024 / 1024}MB`;
