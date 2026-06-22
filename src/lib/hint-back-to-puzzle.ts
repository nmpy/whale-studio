// src/lib/hint-back-to-puzzle.ts
//
// ヒント返答に付く導線 QR「問題に戻る」(hint_cancel_label、既定 "問題に戻る") タップの解決（純関数）。
//
// 背景: ヒント表示後の QR「問題に戻る」は LINE 上では通常の message action として送られ、
//   そのテキスト ("問題に戻る" 等) が問題の回答として扱われ、不正解判定に流れてしまう不具合があった。
//   本関数で「回答判定より前」に、現在フェーズの問題メッセージの hint_cancel_label と照合し、
//   一致したら「戻る対象の問題メッセージ ID」を返す（→ webhook が問題を再表示する）。
//
// - 対象は kind="puzzle" かつ incorrect_quick_replies に有効な action="hint" を持つメッセージのみ。
// - 照合キー = 各ヒント item の hint_cancel_label（trim）＋ 既定 "問題に戻る"
//   （webhook は hint_cancel_label 未設定でも既定ラベルで「問題に戻る」QR を出すため、既定も候補に含める）。
// - 正規化関数は呼び出し側（webhook）から注入し、normKw/normKwLoose と挙動を揃える。
// - 手入力で同一テキストを送った場合も一致しうる（仕様: 文脈付きフォールバックとして許容）。

/** webhook がヒント返答時に「問題に戻る」ラベルを解決する既定値（route.ts と一致させる）。 */
export const DEFAULT_BACK_TO_PUZZLE_LABEL = "問題に戻る";

export interface BackToPuzzleCandidate {
  id: string;
  kind?:                  string | null;
  /** DB の incorrect_quick_replies カラム（QuickReplyItem[] の JSON 文字列）。 */
  incorrectQuickReplies?: string | null;
}

interface HintItemLike {
  action?:            string;
  enabled?:           boolean;
  hint_cancel_label?: string | null;
}

/**
 * 「問題に戻る」タップを現在フェーズの問題メッセージから照合する。
 * 一致したら戻る対象の messageId を返す（複数該当時は最初の問題メッセージ）。
 */
export function matchBackToPuzzle(
  messages:  BackToPuzzleCandidate[],
  inputText: string,
  norm:      { strict: (s: string) => string; loose: (s: string) => string },
): { messageId: string; cancelLabel: string } | null {
  const inStrict = norm.strict(inputText);
  const inLoose  = norm.loose(inputText);

  for (const m of messages) {
    if (m.kind !== "puzzle" || !m.incorrectQuickReplies) continue;
    let items: unknown;
    try { items = JSON.parse(m.incorrectQuickReplies); } catch { continue; }
    if (!Array.isArray(items)) continue;

    const hintItems = (items as HintItemLike[]).filter(
      (i) => !!i && i.action === "hint" && i.enabled !== false,
    );
    if (hintItems.length === 0) continue;

    // webhook が生成しうる「問題に戻る」ラベル集合（各 item の hint_cancel_label ＋ 既定）。
    const cancelLabels = new Set<string>([DEFAULT_BACK_TO_PUZZLE_LABEL]);
    for (const it of hintItems) {
      const cl = (it.hint_cancel_label ?? "").trim();
      if (cl) cancelLabels.add(cl);
    }
    for (const label of cancelLabels) {
      if (norm.strict(label) === inStrict || norm.loose(label) === inLoose) {
        return { messageId: m.id, cancelLabel: label };
      }
    }
  }
  return null;
}
