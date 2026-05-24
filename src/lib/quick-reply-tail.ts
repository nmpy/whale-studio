// src/lib/quick-reply-tail.ts
//
// LINE Message 配列の quickReply を chain tail (= 最後のメッセージ) に集約する helper。
//
// 背景:
//   LINE は 1 通の reply 内で最後のメッセージに設定された quickReply のみを表示する仕様。
//   chain 中間メッセージ (= msg1) に quickReply が付いていても、後続メッセージ (msg2) を
//   一緒に送ると msg1 の quickReply は LINE 画面に出ない。
//
//   この helper は LINE 送信直前に、中間メッセージの quickReply を chain tail に移動する。
//   結果: 「chain head の QR は chain tail で表示される」期待挙動を実現する。
//
// 設計:
//   - in-place で渡された配列を変更する (= 副作用あり)
//   - 1 件のみなら no-op
//   - 既に tail に quickReply があればそのまま (= tail の方を優先)
//   - tail に quickReply がなければ、後ろから前へ走査して最初に見つかった quickReply を移動

/** LineMessage 配列の quickReply を chain tail (= 最後のメッセージ) に集約する。
 *  in-place で配列を変更する。 */
export function moveQuickReplyToTail<T extends { quickReply?: unknown }>(messages: T[]): void {
  if (messages.length <= 1) return;
  const last = messages[messages.length - 1];
  if (last.quickReply !== undefined) return; // 既に末尾にあるならそのまま

  // 末尾から手前へ走査して最初に見つかった quickReply を末尾へ移動
  for (let i = messages.length - 2; i >= 0; i--) {
    const m = messages[i];
    if (m.quickReply !== undefined) {
      last.quickReply = m.quickReply;
      m.quickReply = undefined;
      return;
    }
  }
}
