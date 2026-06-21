// src/app/oas/[id]/works/[workId]/messages/_qr-transition-check.ts
//
// Quick Reply の Step 3「遷移先＝メッセージ」で、選択した遷移先メッセージが編集中メッセージと
// 別フェーズの場合の警告判定（純ロジック・no JSX → node テスト可）。
//
// 背景: メッセージ遷移（target_message_id）は target chain を送るだけで progress.currentPhaseId を
//   更新しない（webhook 仕様。挙動は変えない）。別フェーズのメッセージを送っても currentPhase は
//   前フェーズのままになり、その別フェーズの応答キーワードが反応しない。制作者が気づけるよう警告する。

export type QrTransitionMessage = { id: string; phase_id?: string | null };

/** Step3=メッセージ で、選択した遷移先メッセージが「編集中メッセージと別フェーズ」かを判定。 */
export function isQrCrossPhaseMessageTarget(args: {
  targetType: string | null | undefined;
  targetMessageId: string | null | undefined;
  transitionMessages: QrTransitionMessage[] | null | undefined;
  currentPhaseId: string | null | undefined;
}): boolean {
  if (args.targetType !== "message") return false;        // フェーズ遷移 / なし は対象外
  if (!args.targetMessageId) return false;                // 未選択 → 警告なし
  const m = (args.transitionMessages ?? []).find((x) => x && x.id === args.targetMessageId);
  if (!m) return false;                                   // 不明なメッセージ → 警告なし
  const targetPhaseId = m.phase_id ?? null;
  if (targetPhaseId === null) return false;               // 遷移先にフェーズが無い → 判定不能（落ちない）
  if (!args.currentPhaseId) return false;                 // 編集中メッセージにフェーズが無い → 曖昧なので警告なし
  return targetPhaseId !== args.currentPhaseId;           // 別フェーズ → 警告
}

/** 警告対象の遷移先メッセージのフェーズ ID（名前解決は呼び出し側で phases から）。 */
export function resolveQrTargetMessagePhaseId(
  targetMessageId: string | null | undefined,
  transitionMessages: QrTransitionMessage[] | null | undefined,
): string | null {
  if (!targetMessageId) return null;
  return (transitionMessages ?? []).find((x) => x && x.id === targetMessageId)?.phase_id ?? null;
}

/** 警告文（正解時アクションの語彙に寄せる: 「フェーズは変わらない」「フェーズへ進む」）。 */
export const QR_CROSS_PHASE_WARNING =
  "選択したメッセージは別フェーズにあります。メッセージ遷移ではプレイヤーの現在フェーズは変わらないため、" +
  "そのフェーズの応答キーワードは反応しません。次フェーズへ進めたい場合は、遷移先を「フェーズへ進む」に変更してください。";
