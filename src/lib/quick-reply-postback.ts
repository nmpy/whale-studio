// src/lib/quick-reply-postback.ts
//
// 通常クイックリプライ（QR=Quick Reply）の「送信先（target_message_id / response_message_id /
// target_phase_id）を持つもの」を、**表示ラベルではなく postback の sourceMessageId + qrIndex** で
// 解決する純ロジック（no JSX → node テスト可）。
//
// 背景（バグ）: 通常 QR は従来 message action（label を送信テキストにする）で、webhook 側は
//   matchQrItem が**フェーズ内の QR をラベル/テキスト一致で先頭から探す**。そのため同一フェーズに
//   同名 QR（「次へ」等）を持つメッセージが複数あると、メッセージ B 下の「次へ」をタップしても
//   先頭メッセージ A の「次へ」へ解決され、A の送信先（= B）が再送されて先に進めない。
//
// 修正: 送信先を持つ通常 QR を postback 化し、data に「この QR を表示している元 messageId」と
//   「同メッセージの表示 QR リスト内 index」を持たせる。解決は表示と同じ resolveDisplayQrItems を
//   使い、ラベルに一切依存しない（PR #453 の問題ヒント postback と同思想）。旧テキスト QR 互換の
//   ため matchQrItem（ラベル一致）は legacy fallback として残す。
//
// 注: ここでの QR は「クイックリプライ」の意味（QR コードではない）。

import { resolveDisplayQrItems } from "@/lib/hint-qr";
import type { QuickReplyItem } from "@/types";

/** 通常 QR postback の action 識別子。 */
export const QUICK_REPLY_POSTBACK_ACTION = "quick_reply";

/**
 * 通常 QR が「送信先を持つ」= postback 化対象か判定する。
 *   - action が text/next/custom（タップで送信先へ進む系）であること。
 *   - かつ target_message_id / response_message_id / target_phase_id のいずれかを持つこと。
 *   どれも無い純フリーテキスト QR（keyword/transition に委ねる）は false（= message action のまま）。
 *   url（uri アクション）/ hint（puzzle_hint postback の担当）は対象外。
 */
export function quickReplyItemHasDestination(item: QuickReplyItem | null | undefined): boolean {
  if (!item) return false;
  if (item.action !== "text" && item.action !== "next" && item.action !== "custom") return false;
  return !!(item.target_message_id || item.response_message_id || item.target_phase_id);
}

/**
 * 通常 QR postback の data 文字列（URLSearchParams 形式）。
 * 例: "action=quick_reply&sourceMessageId=<uuid>&qrIndex=0"。固定 prefix + UUID + 小整数で LINE の
 * postback data 上限 300 文字に十分収まる。
 */
export function buildQuickReplyPostbackData(sourceMessageId: string, qrIndex: number): string {
  const p = new URLSearchParams();
  p.set("action", QUICK_REPLY_POSTBACK_ACTION);
  p.set("sourceMessageId", sourceMessageId);
  p.set("qrIndex", String(qrIndex));
  return p.toString();
}

/**
 * postback data から通常 QR の { sourceMessageId, qrIndex } を安全に取り出す。
 * action 不一致 / sourceMessageId 空 / qrIndex が非負整数でない場合は null（呼び出し側は legacy へ）。
 */
export function parseQuickReplyPostback(data: string): { sourceMessageId: string; qrIndex: number } | null {
  let params: URLSearchParams;
  try { params = new URLSearchParams(data); } catch { return null; }
  if (params.get("action") !== QUICK_REPLY_POSTBACK_ACTION) return null;
  const sourceMessageId = (params.get("sourceMessageId") ?? "").trim();
  const qrIndex = Number.parseInt(params.get("qrIndex") ?? "", 10);
  if (!sourceMessageId || !Number.isInteger(qrIndex) || qrIndex < 0) return null;
  return { sourceMessageId, qrIndex };
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

/** QR 解決に必要なメッセージ行の最小フィールド（JSON は文字列）。 */
export interface QuickReplyPostbackMessageRow {
  kind?:                  string | null;
  hintMode?:              string | null;
  quickReplies?:          string | null;  // JSON 文字列
  incorrectQuickReplies?: string | null;  // JSON 文字列
}

/**
 * sourceMessage の表示 QR リスト（buildQuickReplyFromItems に渡した items と同一 = resolveDisplayQrItems）
 * の qrIndex 番目の QR item を解決する。表示時の qrIndex とこの index が一致する（= 表示と解決の単一の真実）。
 *   - 範囲外 / disabled / 送信先を持たない item の場合は null（呼び出し側は安全に無視）。
 *   - ラベル一致は一切使わない。
 */
export function resolveQuickReplyItem(
  row: QuickReplyPostbackMessageRow,
  qrIndex: number,
): QuickReplyItem | null {
  const items = resolveDisplayQrItems({
    kind:                  row.kind ?? "",
    hintMode:              row.hintMode ?? null,
    quickReplies:          parseJsonArray(row.quickReplies),
    incorrectQuickReplies: parseJsonArray(row.incorrectQuickReplies),
  });
  const item = items[qrIndex];
  if (!item || item.enabled === false) return null;
  if (!quickReplyItemHasDestination(item)) return null;
  return item;
}
