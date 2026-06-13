// src/lib/maps/google-maps-loader.ts
// Google Maps JS API（@googlemaps/js-api-loader 新 functional API）の初期化ヘルパー。
// setOptions は一度だけ呼ぶ（singleton）。API キー未設定なら false を返し graceful fallback。

import { setOptions } from "@googlemaps/js-api-loader";

let configured = false;

export const GOOGLE_MAPS_MAP_ID: string | undefined = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;

/** API キーがあれば setOptions を 1 回だけ実行し true を返す。未設定なら false。 */
export function ensureGoogleMapsConfigured(): boolean {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return false;
  if (!configured) {
    setOptions({ key: apiKey, v: "weekly" });
    configured = true;
  }
  return true;
}
