// src/lib/puzzle-hint.ts
//
// 問題（puzzle）ヒント QR を「表示ラベル」ではなく **postback の messageId + hintIndex** で解決する純ロジック。
//
// 背景（バグ）: ヒント QR は従来 message action（label を送信テキストにする）で、webhook 側は
//   matchHintFromPhase が**フェーズ内全メッセージのヒントをラベル一致で先頭から探す**。そのため同一
//   フェーズに同名ヒント（「ヒント①」等）を持つ問題が複数あると、問題2のヒント①をタップしても
//   先頭の問題1のヒント①が返ってしまう。
//
// 修正: 問題下のヒント QR を postback 化し、data に「そのヒントが紐づく問題 messageId」と
//   「同問題内のヒント index」を持たせる。解決は表示と同じ resolveDisplayQrItems を使い、
//   ラベルに一切依存しない（PR #436 の「問題に戻る」postback と同思想）。
//   旧テキスト QR 互換のため matchHintFromPhase（ラベル一致）は legacy fallback として残す。

import { resolveDisplayQrItems } from "@/lib/hint-qr";
import type { QuickReplyItem } from "@/types";

/** 問題ヒント postback の action 識別子。 */
export const PUZZLE_HINT_POSTBACK_ACTION = "puzzle_hint";

/**
 * 問題ヒント postback の data 文字列（URLSearchParams 形式）。
 * 例: "action=puzzle_hint&messageId=<uuid>&hintIndex=0"。固定 prefix + UUID + 小整数で LINE の
 * postback data 上限 300 文字に十分収まる。
 */
export function buildPuzzleHintPostbackData(messageId: string, hintIndex: number): string {
  const p = new URLSearchParams();
  p.set("action", PUZZLE_HINT_POSTBACK_ACTION);
  p.set("messageId", messageId);
  p.set("hintIndex", String(hintIndex));
  return p.toString();
}

/**
 * postback data から問題ヒントの { messageId, hintIndex } を安全に取り出す。
 * action 不一致 / messageId 空 / hintIndex が非負整数でない場合は null（呼び出し側は legacy へ）。
 */
export function parsePuzzleHintPostback(data: string): { messageId: string; hintIndex: number } | null {
  let params: URLSearchParams;
  try { params = new URLSearchParams(data); } catch { return null; }
  if (params.get("action") !== PUZZLE_HINT_POSTBACK_ACTION) return null;
  const messageId = (params.get("messageId") ?? "").trim();
  const hintIndex = Number.parseInt(params.get("hintIndex") ?? "", 10);
  if (!messageId || !Number.isInteger(hintIndex) || hintIndex < 0) return null;
  return { messageId, hintIndex };
}

function parseJsonArray(raw: string | null | undefined): QuickReplyItem[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as QuickReplyItem[]) : null;
  } catch {
    return null;
  }
}

/** 問題メッセージ行（ヒント解決に必要な最小フィールド・JSON は文字列）。 */
export interface PuzzleHintMessageRow {
  kind?:                  string | null;
  hintMode?:              string | null;
  quickReplies?:          string | null;  // JSON 文字列
  incorrectQuickReplies?: string | null;  // JSON 文字列
}

/**
 * 表示（buildQuickReplyFromItems）と**同じ resolveDisplayQrItems** を使い、ヒント QR の
 * 順序付きリストを返す（= ヒント解決の単一の真実。表示時の hintIndex とこの index が一致する）。
 */
export function resolveHintItems(row: PuzzleHintMessageRow): QuickReplyItem[] {
  const items = resolveDisplayQrItems({
    kind:                  row.kind ?? "",
    hintMode:              row.hintMode ?? null,
    quickReplies:          parseJsonArray(row.quickReplies),
    incorrectQuickReplies: parseJsonArray(row.incorrectQuickReplies),
  });
  return items.filter((i) => i.action === "hint" && i.enabled !== false);
}

/** messageId の問題から hintIndex 番目のヒント item を解決（範囲外 / なしは null）。 */
export function resolvePuzzleHint(row: PuzzleHintMessageRow, hintIndex: number): QuickReplyItem | null {
  const hints = resolveHintItems(row);
  return hints[hintIndex] ?? null;
}
