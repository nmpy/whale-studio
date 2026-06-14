// src/lib/x-posts/tracking-server.ts
// 計測URL（/r/[trackingCode]）まわりのサーバー専用ヘルパー。crypto を使うため client から import しない。

import crypto from "crypto";

/** URL-safe な短縮トラッキングコードを生成（11文字程度）。 */
export function generateTrackingCode(): string {
  return crypto.randomBytes(9).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 11);
}

/**
 * IP を hash 化（生値は保存しない）。空は null。
 * salt は env IP_HASH_SALT があれば使用（無くても固定 salt で hash）。
 */
export function hashIp(ip: string | null | undefined): string | null {
  const v = (ip ?? "").trim();
  if (!v) return null;
  const salt = process.env.IP_HASH_SALT ?? "whale-x-posts";
  return crypto.createHash("sha256").update(`${salt}:${v}`).digest("hex").slice(0, 32);
}

/** 計測URLを組み立てる。origin 未指定時は env / 本番ドメインにフォールバック。 */
export function buildTrackingUrl(code: string, origin?: string | null): string {
  const base = (origin || process.env.NEXT_PUBLIC_APP_ORIGIN || "https://app.whale-studio.app").replace(/\/+$/, "");
  return `${base}/r/${code}`;
}

/** リクエストヘッダから接続元 IP を推定（hash 前提・生値は保存しない）。 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  return headers.get("x-real-ip");
}

/** ざっくり Bot/クローラー判定（将来の除外ロジック差し替え用に分離）。 */
export function looksLikeBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return false;
  return /(bot|crawler|spider|crawl|slurp|facebookexternalhit|preview|fetch|monitor|curl|wget|headless)/.test(ua);
}
