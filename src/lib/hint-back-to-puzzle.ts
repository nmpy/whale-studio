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

/** 「問題に戻る」postback の action 識別子。 */
export const BACK_TO_PUZZLE_POSTBACK_ACTION = "hint_back_to_puzzle";

/**
 * 「問題に戻る」postback の data 文字列を組み立てる（URLSearchParams 形式）。
 * 例: "action=hint_back_to_puzzle&messageId=<uuid>"。LINE の postback data 上限 300 文字に十分収まる
 * （固定 prefix + UUID で ~73 文字）。messageId は URL エンコードする。
 */
export function buildBackToPuzzlePostbackData(messageId: string): string {
  const p = new URLSearchParams();
  p.set("action", BACK_TO_PUZZLE_POSTBACK_ACTION);
  p.set("messageId", messageId);
  return p.toString();
}

/**
 * postback data から「問題に戻る」かどうかと対象 messageId を安全に取り出す。
 * action が一致しない / messageId が空・不正なら null（呼び出し側は通常処理へ）。
 */
export function parseBackToPuzzlePostback(data: string): { messageId: string } | null {
  let params: URLSearchParams;
  try { params = new URLSearchParams(data); } catch { return null; }
  if (params.get("action") !== BACK_TO_PUZZLE_POSTBACK_ACTION) return null;
  const messageId = (params.get("messageId") ?? "").trim();
  if (!messageId) return null;
  return { messageId };
}

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
 * 「問題に戻る」message action（既存データ互換 fallback）を現在フェーズの問題から照合する。
 *
 * 複数問題が同じ cancel ラベルを持つ場合に**先頭固定で誤った問題に戻さない**:
 *   - 候補が 1 つだけ → その問題を返す。
 *   - 候補が複数 → `preferIds`（直近送信 = frontier の message ID）で 1 つに絞れれば、その問題を返す
 *     （= 直前に出題されていた問題を優先）。
 *   - それでも特定できない → null（= 先頭固定にせず通常フローへフォールバック）。
 *     ※ null のときは通常フローへ流れるため、状況によっては通常誤答として不正解になり得るが、
 *       これは「誤った問題を再表示しない」ことを優先した互換上の安全フォールバックとして意図通り。
 *
 * 新規生成の「問題に戻る」QR は postback（messageId 付き）で正確に戻すため、この曖昧ケースは
 * 主に「デプロイ前にチャット履歴へ送られた旧テキスト QR」を後からタップした場合のみ。
 */
export function matchBackToPuzzle(
  messages:  BackToPuzzleCandidate[],
  inputText: string,
  norm:      { strict: (s: string) => string; loose: (s: string) => string },
  preferIds?: Iterable<string>,
): { messageId: string; cancelLabel: string } | null {
  const inStrict = norm.strict(inputText);
  const inLoose  = norm.loose(inputText);
  const matches: { messageId: string; cancelLabel: string }[] = [];

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
    const hit = [...cancelLabels].find(
      (label) => norm.strict(label) === inStrict || norm.loose(label) === inLoose,
    );
    if (hit) matches.push({ messageId: m.id, cancelLabel: hit });
  }

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // 複数候補: frontier（直近送信）で 1 つに絞れれば、それ（= 直前に出題された問題）を優先。
  if (preferIds) {
    const prefer = new Set(preferIds);
    const inFrontier = matches.filter((m) => prefer.has(m.messageId));
    if (inFrontier.length === 1) return inFrontier[0];
  }
  // 特定できない → 先頭固定にせず null（誤った問題を再表示しない）。
  return null;
}
