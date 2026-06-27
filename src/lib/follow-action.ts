// src/lib/follow-action.ts
//
// LINE 友だち追加（follow イベント）時に Whale Studio が「何を送るか」を決める純関数。
//
// 方針（重要）:
//   友だち追加時の送信は Whale Studio 側の設定だけで決める。
//   未設定・空文字・空白のみのときは「デフォルト文面・フォールバック文面を一切送らない」。
//   LINE OA Manager 側のあいさつ ON/OFF は Whale Studio から制御できない前提で、
//   ここでは「webhook の follow イベントに対して何を送るか」だけを責務とする。
//
//   - followAction = "none"         : 何も送らない
//   - followAction = "welcome_wait" : welcomeMessage が明示設定（trim 後 非空）のときのみ送る
//   - followAction = "auto_start"   : 開始対象（開始フェーズ）があるときのみ開始する
//
// 送信判断のみを行い、実際の文面組み立て／送信は呼び出し側（webhook route）が担う。

export type FollowAction = "none" | "welcome_wait" | "auto_start";

export type FollowDecision =
  | { action: "skip";          reason: string }
  | { action: "send_welcome";  reason: string }
  | { action: "auto_start";    reason: string };

export interface FollowDecisionInput {
  /** 作品単位の友だち追加時動作。null/undefined は既定 auto_start。 */
  followAction:   FollowAction | string | null | undefined;
  /** Work.welcomeMessage（welcome_wait のときに参照）。 */
  welcomeMessage: string | null | undefined;
  /** auto_start のときに「開始対象（開始フェーズ等）」が存在するか。 */
  hasStartTarget: boolean;
}

/**
 * follow イベントに対して送るべき挙動を決める。
 *
 * reason は info ログにそのまま使える短い文字列を返す:
 *   - "followAction=none"
 *   - "welcomeMessage empty"
 *   - "welcome_wait message"
 *   - "auto_start target missing"
 *   - "auto_start first message"
 */
export function decideFollowBehavior(input: FollowDecisionInput): FollowDecision {
  const action = (input.followAction ?? "auto_start") as FollowAction;

  if (action === "none") {
    return { action: "skip", reason: "followAction=none" };
  }

  if (action === "welcome_wait") {
    // trim 後に空なら送らない（デフォルト文面へのフォールバックはしない）。
    if (!input.welcomeMessage || input.welcomeMessage.trim() === "") {
      return { action: "skip", reason: "welcomeMessage empty" };
    }
    return { action: "send_welcome", reason: "welcome_wait message" };
  }

  // auto_start（既定）: 開始対象が無いときはデフォルト文面を送らずスキップ。
  if (!input.hasStartTarget) {
    return { action: "skip", reason: "auto_start target missing" };
  }
  return { action: "auto_start", reason: "auto_start first message" };
}

/**
 * あいさつメッセージ設定の解決（OA優先 + active Work フォールバック）。PR-1。
 *
 * OA単位（Oa.welcomeMessage / Oa.followAction）を優先し、未設定（null/undefined）なら
 * 既存どおり active Work の値にフォールバックする（移行期の互換）。
 *   - welcomeMessage: oa.welcomeMessage ?? work.welcomeMessage ?? null
 *   - followAction:   oa.followAction   ?? work.followAction   ?? "auto_start"
 *
 * 実行ロジック（送信・開始）は不変。判定に渡す「実効値」をここで一本化するだけ。
 * resume_enabled には一切触れない。
 */
export function resolveFollowSettings(
  oa:   { welcomeMessage?: string | null; followAction?: string | null } | null | undefined,
  work: { welcomeMessage?: string | null; followAction?: string | null } | null | undefined,
): { welcomeMessage: string | null; followAction: FollowAction | string } {
  return {
    welcomeMessage: oa?.welcomeMessage ?? work?.welcomeMessage ?? null,
    followAction:   oa?.followAction   ?? work?.followAction   ?? "auto_start",
  };
}
