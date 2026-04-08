// src/lib/checkin-mode.ts
// checkin_mode のヘルパー関数。
// GPS 判定が必要かどうかは checkin_mode から導出する。
// gps_enabled はレガシーフィールドであり、このヘルパーで置き換える。

import type { CheckinMode } from "@/types";

/** GPS 判定が必要な方式か */
export function requiresGps(mode: CheckinMode | string): boolean {
  return mode === "gps_only" || mode === "qr_and_gps";
}

/** QR 読み取りが含まれる方式か */
export function includesQr(mode: CheckinMode | string): boolean {
  return mode === "qr_only" || mode === "qr_and_gps";
}

/** checkin_mode から gps_enabled の整合値を導出する（DB 書き込み用） */
export function deriveGpsEnabled(mode: CheckinMode | string): boolean {
  return requiresGps(mode);
}
