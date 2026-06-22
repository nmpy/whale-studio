// src/lib/image-action-phase.ts
//
// 画像タップ「メッセージを送信する＋フェーズ遷移」(image_action_type="message_with_phase") の
// 遷移先解決（純関数）。webhook がユーザーのテキスト受信時に、現在フェーズの画像メッセージから
// image_action_text 一致で遷移先フェーズ (image_action_phase_id) を引く。
//
// - 対象は messageType="image" かつ imageActionType="message_with_phase" のメッセージのみ。
// - image_action_text 一致 かつ image_action_phase_id 設定済み のときだけ遷移先を返す。
// - 正規化関数は呼び出し側（webhook）から注入し、webhook の normKw/normKwLoose と挙動を揃える。
//   （手入力で同一テキストを送った場合も一致しうる＝仕様。作品外/他フェーズの画像には反応しない。）

export interface ImagePhaseCandidate {
  id: string;
  messageType?:        string | null;
  imageActionType?:    string | null;
  imageActionText?:    string | null;
  imageActionPhaseId?: string | null;
}

export function matchImageActionPhaseTransition(
  messages:  ImagePhaseCandidate[],
  inputText: string,
  norm:      { strict: (s: string) => string; loose: (s: string) => string },
): { targetPhaseId: string; messageId: string; actionText: string } | null {
  const inStrict = norm.strict(inputText);
  const inLoose  = norm.loose(inputText);
  for (const m of messages) {
    if (m.messageType !== "image") continue;
    if (m.imageActionType !== "message_with_phase") continue;
    const actionText    = (m.imageActionText ?? "").trim();
    const targetPhaseId = (m.imageActionPhaseId ?? "").trim();
    if (!actionText || !targetPhaseId) continue;
    if (norm.strict(actionText) === inStrict || norm.loose(actionText) === inLoose) {
      return { targetPhaseId, messageId: m.id, actionText };
    }
  }
  return null;
}
