// src/lib/hint-qr.ts
//
// 問題（puzzle）メッセージのヒント用クイックリプライ（QR=Quick Reply）を、LINE 送信 payload に
// 付与・照合するための純ロジック（no JSX → node テスト可）。
//
// 背景: 問題メッセージのヒントは incorrect_quick_replies（action="hint"）に保存される。
//   従来は送信 payload 生成（buildPhaseMessages）が quick_replies しか見ておらず、
//   hint_mode="always"（既定）でも問題メッセージにヒント QR が付かなかった。
//   表示（payload 生成）とタップ照合（webhook matchHintFromPhase）で同じラベルを使うため、
//   ラベル正規化をこの 1 箇所に集約する。
//
// 注: ここでの QR は「クイックリプライ」の意味（QR コードではない）。

import type { QuickReplyItem } from "@/types";

/**
 * incorrect_quick_replies のヒント QR（action="hint"・enabled）にデフォルトラベルを付与する。
 *   - 既存ラベルが空でなければそのまま使う（ラベル・nameがある場合は優先）。
 *   - 空の場合: 1 件なら「ヒント」、複数件なら「ヒント1」「ヒント2」…。
 * 表示（送信 payload）と webhook のタップ照合で同じラベルになるよう共有する。
 */
export function normalizeHintQrItems(items: QuickReplyItem[] | null | undefined): QuickReplyItem[] {
  const hints = (items ?? []).filter(
    (i): i is QuickReplyItem => !!i && i.action === "hint" && i.enabled !== false,
  );
  return hints.map((it, i) => ({
    ...it,
    label: (it.label ?? "").trim() || (hints.length === 1 ? "ヒント" : `ヒント${i + 1}`),
  }));
}

/**
 * メッセージ送信 payload に付与する quickReply アイテムを解決する。
 *   - 通常: quick_replies をそのまま。hint_mode が "always" 以外なら quick_replies 内の
 *     action="hint" を隠す（既存仕様を維持）。
 *   - 問題（kind="puzzle"）かつ hint_mode="always": 上記に加えて incorrect_quick_replies の
 *     ヒント QR を問題メッセージに付与する。既存の明示的な quick_replies を先頭に維持し、
 *     ヒントは後ろに追加する（LINE/アプリ上限の切り詰めは呼び出し側 buildQuickReplyFromItems が担当）。
 */
export function resolveDisplayQrItems(args: {
  kind:                  string;
  hintMode:              string | null | undefined;
  quickReplies:          QuickReplyItem[] | null | undefined;
  incorrectQuickReplies: QuickReplyItem[] | null | undefined;
}): QuickReplyItem[] {
  const showAll = args.hintMode === "always" || !args.hintMode;
  const base = args.quickReplies ?? [];
  const visibleBase = showAll ? base : base.filter((i) => i.action !== "hint");

  if (args.kind === "puzzle" && showAll) {
    // 既存 QR を消さず、ヒントを後ろに追加（重複ラベルがあっても表示はそのまま・上限は後段で切り詰め）。
    return [...visibleBase, ...normalizeHintQrItems(args.incorrectQuickReplies)];
  }
  return visibleBase;
}
