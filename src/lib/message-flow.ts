// src/lib/message-flow.ts
//
// メッセージ管理まわりの「分岐ルール」を表す純関数群。
// webhook / メッセージ編集フォームから参照し、ロジックを 1 箇所に集約してテスト可能にする。

/**
 * 開始トリガー再送時に「途中から再開する / 最初からやり直す」の選択肢を出すべきか。
 *
 * - 作品設定 resumeEnabled=false → 常に false（途中状態があっても選択肢を出さず、最初から開始に寄せる）。
 *   undefined は migration 前 / 旧データ互換で従来挙動 = true 扱い。
 * - resumeEnabled が false でなく、かつ「進行中（未エンディング・currentPhaseId あり）」のときのみ true。
 */
export function shouldOfferResumeChoice(args: {
  /** Work.resumeEnabled（undefined = 旧データ互換で true 扱い） */
  resumeEnabled:  boolean | null | undefined;
  /** UserProgress が存在するか */
  hasProgress:    boolean;
  /** エンディング到達済みか */
  reachedEnding:  boolean;
  /** 現在フェーズ ID（null = フェーズ未確定） */
  currentPhaseId: string | null;
}): boolean {
  if (args.resumeEnabled === false) return false;
  return args.hasProgress && !args.reachedEnding && args.currentPhaseId !== null;
}

/**
 * メッセージ編集フォームで「このメッセージの後の遷移」を編集不可にすべきか。
 *
 * 謎・問題（puzzle）で正解時アクションがフェーズ遷移（transition / text_and_transition）の場合、
 * 正解時のフェーズ遷移と「後の遷移」が競合するため、後者を編集不可（グレーアウト）にする。
 * 正解時アクションをそれ以外に戻すと false に戻り、再び編集可能になる。
 */
export function nextTransitionDisabledByPuzzle(args: {
  isPuzzle:      boolean;
  correctAction: string | null | undefined;
}): boolean {
  return (
    args.isPuzzle &&
    (args.correctAction === "transition" || args.correctAction === "text_and_transition")
  );
}
