// src/lib/qr-frontier.ts
//
// QR / Quick Reply の「有効範囲（frontier）」を扱う純関数。
//
// 背景:
//   webhook の matchQrItem は従来「現在フェーズの全メッセージ」の QR を走査していたため、
//   target_message_id の分岐（フェーズ遷移しない）を踏んでも進行位置が変わらず、
//   過去に表示された QR を再タップすると同じ chain が無限に再送される問題があった。
//
// 対策（frontier 方式）:
//   UserProgress.lastSentMessageIds に「直近送信した chain の messageId 群」を保存し、
//   QR 照合をその messageId 群（= 現在地）に限定する。
//   lastSentMessageIds が null（レガシー progress）なら従来どおりフェーズ全体を走査する。

/**
 * lastSentMessageIds（JSON 文字列の string[]）を Set にパースする。
 * - null/空/壊れた JSON/非配列 は null を返す（= レガシー fallback 扱い）。
 * - 文字列要素のみ採用（型安全）。空配列は null（fallback）扱い。
 * 本番で落ちないことを優先し、例外は飲み込んで null を返す。
 */
export function parseFrontier(json: string | null | undefined): Set<string> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.filter((x): x is string => typeof x === "string");
    return ids.length > 0 ? new Set(ids) : null;
  } catch {
    return null;
  }
}

/**
 * QR 照合の対象メッセージを frontier で絞り込む。
 * - frontier が有効（非空 Set）→ frontier に含まれる messageId のメッセージだけを返す（mode="frontier"）。
 *   該当が無ければ空配列（= どの QR にもマッチしない → 無限再送を防ぐ）。
 * - frontier が null → 全メッセージを返す（mode="phase_legacy"・後方互換）。
 */
export function selectQrScope<T extends { id: string }>(
  messages: readonly T[],
  frontier: Set<string> | null,
): { scoped: T[]; mode: "frontier" | "phase_legacy" } {
  if (frontier && frontier.size > 0) {
    return { scoped: messages.filter((m) => frontier.has(m.id)), mode: "frontier" };
  }
  return { scoped: [...messages], mode: "phase_legacy" };
}
