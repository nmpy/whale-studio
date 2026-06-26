// src/app/oas/[id]/works/[workId]/messages/_message-list-model.ts
//
// メッセージ一覧（再設計版）の **表示専用** 純ロジック。
//   - トリガー種別グルーピング（条件なし/QR/応答/チェックイン/その他）
//   - カードに出す警告ラベルの集約
//
// 重要: これは「一覧の見せ方を整理する」ためだけのもの。送信順 / 保存 / 応答判定 /
//   フェーズ遷移 / クイックリプライ挙動などの **実行ロジックには一切影響しない**。
//   判定は既存データ（kind / trigger_keyword / quick_replies.target_message_id /
//   checkin_trigger_next_message_id）の **確実な信号のみ** で行い、確実に置けないものは
//   "other"（その他 / 未分類）へ逃がす（推測で分類しない）。

import type { MessageWithRelations, QuickReplyItem } from "@/types";

export type TriggerGroupKey = "sequential" | "quick_reply" | "response" | "checkin" | "other";

/** グループの表示順（上から）。 */
export const TRIGGER_GROUP_ORDER: TriggerGroupKey[] = ["sequential", "quick_reply", "response", "checkin", "other"];

/** グループ見出しの配色/ラベル（handoff デザイントークン準拠）。 */
export const TRIGGER_GROUP_META: Record<TriggerGroupKey, { icon: string; label: string; bg: string; color: string }> = {
  sequential:  { icon: "→",  label: "条件なし（順番に送信）", bg: "#F0F2F0", color: "#555555" },
  quick_reply: { icon: "◉",  label: "クイックリプライ",       bg: "#FBF7EE", color: "#8A6530" },
  response:    { icon: "💬", label: "応答メッセージ",         bg: "#E6F5F1", color: "#2D7A62" },
  checkin:     { icon: "📍", label: "チェックイン",           bg: "#EEF2FA", color: "#3A52A0" },
  other:       { icon: "•",  label: "その他 / 未分類",        bg: "#F4F4F5", color: "#6B7280" },
};

/** 全メッセージから「到達側」判定用の逆引きインデックスを作る（分類専用・ロジック不変）。
 *  - qrTargetIds:      いずれかの QR の target_message_id 対象（QRタップで到達するメッセージ）
 *  - checkinTargetIds: いずれかの checkin_trigger_next_message_id 対象（到着後に送信されるメッセージ） */
export function buildTriggerIndexes(messages: MessageWithRelations[]): {
  qrTargetIds: Set<string>;
  checkinTargetIds: Set<string>;
} {
  const qrTargetIds = new Set<string>();
  const checkinTargetIds = new Set<string>();
  for (const m of messages) {
    const qrs = (m.quick_replies ?? []) as QuickReplyItem[];
    for (const qr of qrs) {
      if (qr && qr.enabled !== false && typeof qr.target_message_id === "string" && qr.target_message_id) {
        qrTargetIds.add(qr.target_message_id);
      }
    }
    const ck = (m as { checkin_trigger_next_message_id?: string | null }).checkin_trigger_next_message_id;
    if (typeof ck === "string" && ck) checkinTargetIds.add(ck);
  }
  return { qrTargetIds, checkinTargetIds };
}

/**
 * head メッセージのトリガー種別グループを判定する（表示整理のみ・実行ロジック非影響）。
 * 優先順（確実な信号のみ）:
 *   1. 応答メッセージ:  kind="response"、または（trigger_keyword 設定あり かつ kind!="start"）
 *   2. チェックイン:    到達側（checkin_trigger_next_message_id の対象）
 *   3. クイックリプライ: 到達側（QR target_message_id の対象）
 *   4. 条件なし/順送り:  コンテンツ系メッセージ（hint / system_notice 以外。puzzle もここ）
 *   5. その他/未分類:    上記で確実に置けないもの（hint / system_notice が head 等）
 * チェックイン設定「元」の通常メッセージは、他の信号が無ければ 4(順送り) に入る（仕様どおり）。
 */
export function classifyTrigger(
  msg: Pick<MessageWithRelations, "id" | "kind" | "trigger_keyword">,
  idx: { qrTargetIds: Set<string>; checkinTargetIds: Set<string> },
): TriggerGroupKey {
  const kind = msg.kind;
  const hasKeyword = !!(msg.trigger_keyword && msg.trigger_keyword.trim());
  if (kind === "response" || (hasKeyword && kind !== "start")) return "response";
  if (idx.checkinTargetIds.has(msg.id)) return "checkin";
  if (idx.qrTargetIds.has(msg.id)) return "quick_reply";
  if (kind !== "hint" && kind !== "system_notice") return "sequential"; // normal / start / puzzle / 既定
  return "other";
}

export type MessageWarningLabel =
  | "キーワード未設定"
  | "遷移先未設定"
  | "未接続"
  | "連続5通超"
  | "Flexキーワード警告";

/** カードに常時表示する警告ラベルを集約する（既存の導線状態 / 連続 / Flex 判定結果を渡すだけ）。
 *  既存で見えていた警告を1つも落とさないための単一の集約点。 */
export function getMessageWarnings(args: {
  missingKeyword?: boolean;  // flowInfo.missingKeyword
  hasBrokenLink?: boolean;   // flowInfo.hasBrokenLink
  unreferenced?: boolean;    // flowInfo.unreferenced
  chainLen: number;          // chainLengthFrom(messages, id)
  chainLimit: number;        // LINE_REPLY_MAX (5)
  hasFlexIssue?: boolean;    // findFlexKeywordPhaseIssues(...).length > 0
}): MessageWarningLabel[] {
  const w: MessageWarningLabel[] = [];
  if (args.missingKeyword) w.push("キーワード未設定");
  if (args.hasBrokenLink) w.push("遷移先未設定");
  if (args.unreferenced) w.push("未接続");
  if (args.chainLen > args.chainLimit) w.push("連続5通超");
  if (args.hasFlexIssue) w.push("Flexキーワード警告");
  return w;
}

/** 赤（hard）で出す警告か。それ以外は橙（soft）。 */
export function isHardWarning(w: MessageWarningLabel): boolean {
  return w === "未接続" || w === "連続5通超";
}
