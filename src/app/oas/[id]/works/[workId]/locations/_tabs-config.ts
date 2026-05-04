// src/app/oas/[id]/works/[workId]/locations/_tabs-config.ts
//
// 「ロケーション」タブの純粋ロジック（JSX を含まないため Vitest から直接 import 可）。

export type LocationTab = "gps" | "beacons" | "qr";

export const LOCATION_TABS: Array<{
  key: LocationTab;
  label: string;
  description: string;
}> = [
  {
    key: "gps",
    label: "GPS",
    description: "緯度経度と半径を使って、ユーザーが指定地点にいるかを判定します。",
  },
  {
    key: "beacons",
    label: "ビーコン",
    description: "LINE Beacon の検知イベントを使って、近づいたユーザーにメッセージ送信や進行処理を実行します。",
  },
  {
    key: "qr",
    label: "QR",
    description: "現地に設置したQRコードから、特定の遷移・メッセージ・チェックインを発火します。",
  },
];

export function isValidLocationTab(value: string | null | undefined): value is LocationTab {
  return value === "gps" || value === "beacons" || value === "qr";
}

/** ?tab=... を読み取り、不正値は "gps" にフォールバックする */
export function resolveLocationTab(value: string | null | undefined): LocationTab {
  return isValidLocationTab(value) ? value : "gps";
}
