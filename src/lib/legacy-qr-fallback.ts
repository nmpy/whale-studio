// src/lib/legacy-qr-fallback.ts
//
// legacy（postback ではない）ラベル一致 fallback の「候補収集」純ロジック。
// webhook の matchQrItem / matchHintFromPhase が、旧 message-action / 旧LINE履歴 / 手入力ラベル
// 経路で QR・ヒントを解決する際の候補を、**既存と同じ走査順で**列挙する（先頭が既存 return と一致）。
//
// 目的: 挙動は一切変えず（先頭一致を維持）、
//   - fallback が使われた事実（used）
//   - 同一スコープ内に同名候補が複数ある事実（ambiguous）
// を webhook 側で WARN 観測できるよう、候補配列（順序つき）を返すだけ。
// マッチ判定は webhook 側の normKw/normKwLoose を注入して既存と同一にする。

import { normalizeHintQrItems } from "@/lib/hint-qr";
import type { QuickReplyItem } from "@/types";

/** 入力・キーの正規化関数（webhook の normKw / normKwLoose を注入）。 */
export type LegacyNorm = { strict: (s: string) => string; loose: (s: string) => string };

/** 候補収集に必要なメッセージ行の最小フィールド（JSON は文字列）。 */
export interface LegacyQrMsgRow {
  id:                     string;
  quickReplies?:          string | null;  // JSON 文字列
  kind?:                  string | null;
  hintMode?:              string | null;
  incorrectQuickReplies?: string | null;  // JSON 文字列
}

export interface LegacyQrCandidate {
  messageId: string;
  matchKey:  string;
  item:      QuickReplyItem;
}
export interface LegacyHintCandidate extends LegacyQrCandidate {
  /** マッチしたメッセージの hint 表示 items（matchHintFromPhase の qrItems 相当）。 */
  qrItems: QuickReplyItem[];
}

function parseArr(raw: string | null | undefined): QuickReplyItem[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as QuickReplyItem[]) : null;
  } catch {
    return null;
  }
}

/**
 * matchQrItem 相当: 送信先を持つ通常 QR（action≠hint・enabled・response/target のいずれか）で
 * 入力ラベルに一致する候補を、走査順（メッセージ順→item順）で列挙する。
 * 先頭要素が既存 matchQrItem の return と一致する（挙動不変）。
 */
export function collectLegacyQrMatches(
  messages: readonly LegacyQrMsgRow[],
  inputText: string,
  norm: LegacyNorm,
): LegacyQrCandidate[] {
  const inputNorm  = norm.strict(inputText);
  const inputLoose = norm.loose(inputText);
  const out: LegacyQrCandidate[] = [];
  for (const msg of messages) {
    const items = parseArr(msg.quickReplies);
    if (!items) continue;
    for (const item of items) {
      if (item.action === "hint") continue; // ヒントは collectLegacyHintMatches が処理
      if (item.enabled === false) continue;
      if (!item.response_message_id && !item.target_message_id && !item.target_phase_id) continue;
      const matchKey = item.value?.trim() || item.label;
      if (inputNorm === norm.strict(matchKey) || inputLoose === norm.loose(matchKey)) {
        out.push({ messageId: msg.id, matchKey, item });
      }
    }
  }
  return out;
}

/**
 * matchHintFromPhase 相当: hint QR（action=hint・enabled）で入力ラベルに一致する候補を走査順で列挙する。
 * items は quick_replies ＋（puzzle なら incorrect_quick_replies を normalizeHintQrItems したもの）。
 * hintMode="hidden" のメッセージはスキップ（既存仕様）。先頭要素が既存 return と一致する（挙動不変）。
 */
export function collectLegacyHintMatches(
  messages: readonly LegacyQrMsgRow[],
  inputText: string,
  norm: LegacyNorm,
): LegacyHintCandidate[] {
  const inputNorm  = norm.strict(inputText);
  const inputLoose = norm.loose(inputText);
  const out: LegacyHintCandidate[] = [];
  for (const msg of messages) {
    if (msg.hintMode === "hidden") continue;
    const items: QuickReplyItem[] = [];
    const qr = parseArr(msg.quickReplies);
    if (qr) items.push(...qr);
    if (msg.kind === "puzzle") {
      const inc = parseArr(msg.incorrectQuickReplies);
      if (inc) items.push(...normalizeHintQrItems(inc));
    }
    if (items.length === 0) continue;
    for (const item of items) {
      if (item.action !== "hint") continue;
      if (item.enabled === false) continue;
      const keys = [item.value?.trim(), item.label].filter(Boolean) as string[];
      const matched = keys.some((k) => norm.strict(k) === inputNorm || norm.loose(k) === inputLoose);
      if (matched) {
        out.push({ messageId: msg.id, matchKey: keys[0] ?? item.label, item, qrItems: items });
      }
    }
  }
  return out;
}
