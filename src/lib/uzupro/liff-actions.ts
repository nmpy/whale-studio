// src/lib/uzupro/liff-actions.ts
// for UZU Pro プレイヤー一覧: LIFF リンク状態 → CMS 上の主要アクションの純関数（表示ロジックを集約・テスト可能に）。
//
// 平文 LIFF URL は発行/再発行のレスポンスに一度だけ載る（DB は tokenHash のみ・平文は保存しない）。
//   - 未発行(unissued)         → 「発行」（issue）。成功時に URL を表示してコピーさせる。
//   - 発行済み/連携済み(issued/linked) → 既存の有効リンクの平文は再取得できないため「再発行」で新 URL を得る（旧 URL は失効）。
//   - 失効/期限切れ/エラー(revoked/expired/error) → 「再発行」。
//
// これにより「多重クリック/並行でも有効リンクは常に 1 本」（発行/再発行は行ロック + 部分 UNIQUE で保証済み）を維持しつつ、
// どの状態からでも「コピー可能な有効 URL」に到達できる導線を提供する。

import type { UzuProLiffState } from "@/lib/uzupro/player-view";

export type UzuProLiffAction = {
  /** 実行する API 種別。 */
  kind: "issue" | "reissue";
  /** ボタン表示ラベル。 */
  label: string;
  /** 旧 URL を失効させる操作か（確認ダイアログを出す）。 */
  destructive: boolean;
};

/**
 * LIFF 状態から「コピー可能な有効 URL を得る」ための主要アクションを返す。
 */
export function liffPrimaryAction(state: UzuProLiffState): UzuProLiffAction {
  switch (state) {
    case "unissued":
      return { kind: "issue", label: "LIFF URLを発行", destructive: false };
    case "issued":
    case "linked":
      // 既存の有効リンクの平文は保存していないため、URL を得るには再発行（旧 URL 失効）。
      return { kind: "reissue", label: "URLを再発行", destructive: true };
    case "revoked":
    case "error":
    default:
      // 失効・期限切れ(deriveLiffState では revoked)・エラー → 再発行。
      return { kind: "reissue", label: "再発行", destructive: true };
  }
}
