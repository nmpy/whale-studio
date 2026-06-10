// src/lib/liff/copy.ts
//
// 体験者向け LIFF（チェックイン）画面のページレベル文言・表示プレゼンテーションを集約する。
// GPS / QR の状態別文言は既存の gps-status.ts / qr.ts に集約済みなので、ここでは
// /liff チェックインページ自身の「初期化中 / エラー / 結果」の見せ方だけを扱う。
//
// 重要: ユーザーには技術的な内部コード（NOT_IN_LINE / message_not_configured 等）を直接見せない。
//       ただし内部 outcome/status コードは変更せず、console.error / サーバーログには残す（呼び出し側の責務）。

import type { LiffStateVariant } from "@/components/liff/experience/LiffIconBadge";

export type LiffErrorPresentation = {
  variant: LiffStateVariant;
  title: string;
  /** バッジに出す絵文字。 */
  icon: string;
  /** 閉じる/戻るボタンの文言。 */
  closeLabel: string;
};

/**
 * チェックインページのエラーコード → 体験者向けの見せ方。
 * description（本文）は呼び出し側が持つ state.message（既にやわらかい文言）を使う。
 */
export function resolveLiffErrorPresentation(code: string): LiffErrorPresentation {
  switch (code) {
    case "NOT_IN_LINE":
      return { variant: "info", title: "LINE で開いてください", icon: "📱", closeLabel: "閉じる" };
    case "GPS_FAILED":
      return { variant: "warning", title: "位置情報を取得できません", icon: "📍", closeLabel: "閉じる" };
    case "MISSING_PARAMS":
      return { variant: "info", title: "このページはチェックイン用です", icon: "🔗", closeLabel: "閉じる" };
    case "SCENARIO_NOT_STARTED":
      return { variant: "info", title: "作品がまだ始まっていません", icon: "▶️", closeLabel: "LINEのトークに戻る" };
    case "NO_LIFF_ID":
    case "LIFF_INIT_FAILED":
      return { variant: "warning", title: "設定を確認しています", icon: "⚙️", closeLabel: "閉じる" };
    default:
      // LIFF_ERROR / API_ERROR / NETWORK / その他
      return { variant: "error", title: "うまく開けませんでした", icon: "🌊", closeLabel: "閉じる" };
  }
}

export type CheckinResultPresentation = {
  variant: LiffStateVariant;
  title: string;
  icon?: string;
};

/** チェックイン結果ステータス → 見せ方（本文・スタンプ等の詳細は呼び出し側が組み立てる）。 */
export function resolveCheckinResultPresentation(status: string): CheckinResultPresentation {
  switch (status) {
    case "checked_in":
      return { variant: "success", title: "チェックインしました" }; // success は自動でチェックアイコン
    case "cooldown":
      return { variant: "info", title: "もう少しで再開できます", icon: "⏳" };
    case "out_of_range":
    default:
      return { variant: "warning", title: "まだ対象エリアの外です", icon: "📍" };
  }
}

/** チェックインページの読み込み中ステップ共通文言。 */
export const LIFF_LOADING_COPY = {
  title: "準備しています",
  description: "このまま少しだけお待ちください。",
} as const;
